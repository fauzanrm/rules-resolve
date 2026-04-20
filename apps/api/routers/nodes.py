from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_connection

router = APIRouter()


class OutlineNode(BaseModel):
    node_type: Literal["h1", "h2", "h3"]   # IS the heading level; h1/h2/h3
    label: str
    start_canonical_index: int              # 0 for inferred nodes
    end_canonical_index: int                # 0 for inferred nodes


class NodesState(BaseModel):
    chatroom_id: int
    document_id: Optional[int] = None
    has_canonical_words: bool
    committed_nodes: Optional[List[OutlineNode]] = None


class CommitNodesRequest(BaseModel):
    nodes: List[OutlineNode]


def purge_nodes(document_id: int) -> None:
    """Delete all outline nodes for a document. Safe to call if absent."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM document_nodes WHERE document_id = %s",
                    (document_id,),
                )
    except Exception:
        pass


def _resolve_doc(chatroom_id: int) -> Optional[int]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.id FROM documents d
                JOIN chatroom_documents cd ON cd.document_id = d.id
                WHERE cd.chatroom_id = %s
                ORDER BY d.id ASC LIMIT 1
                """,
                (chatroom_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None


def _chatroom_exists(chatroom_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM chatrooms WHERE id = %s", (chatroom_id,))
            return cur.fetchone() is not None


def _has_canonical_words(document_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM document_canonical_words WHERE document_id = %s",
                (document_id,),
            )
            row = cur.fetchone()
            return (row[0] > 0) if row else False


def _load_committed(document_id: int) -> Optional[List[OutlineNode]]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT node_type, label, start_canonical_index, end_canonical_index
                FROM document_nodes
                WHERE document_id = %s
                ORDER BY node_index
                """,
                (document_id,),
            )
            rows = cur.fetchall()
    if not rows:
        return None
    return [
        OutlineNode(
            node_type=row[0],
            label=row[1],
            start_canonical_index=row[2] or 0,
            end_canonical_index=row[3] or 0,
        )
        for row in rows
    ]


def _is_inferred(node: OutlineNode) -> bool:
    return node.start_canonical_index == 0 and node.end_canonical_index == 0


def _compute_parents(nodes: List[OutlineNode]) -> List[Optional[int]]:
    parents: List[Optional[int]] = []
    last_h1: Optional[int] = None
    last_h2: Optional[int] = None
    for i, node in enumerate(nodes):
        if node.node_type == "h1":
            parents.append(None)
            last_h1 = i
            last_h2 = None
        elif node.node_type == "h2":
            parents.append(last_h1)
            last_h2 = i
        else:
            parents.append(last_h2)
    return parents


def _validate_nodes(nodes: List[OutlineNode]) -> None:
    for i, node in enumerate(nodes):
        if not node.label.strip():
            raise HTTPException(status_code=400, detail=f"Node at index {i} has an empty label")
        if node.start_canonical_index > node.end_canonical_index:
            raise HTTPException(
                status_code=400,
                detail=f"Node at index {i}: start_canonical_index must be <= end_canonical_index",
            )

    # Validate explicit node ordering and overlap (skip inferred nodes with 0,0)
    explicit = [(i, n) for i, n in enumerate(nodes) if not _is_inferred(n)]
    sorted_by_ci = sorted(explicit, key=lambda t: t[1].start_canonical_index)

    if [t[0] for t in sorted_by_ci] != [t[0] for t in explicit]:
        raise HTTPException(
            status_code=400,
            detail="Explicit nodes must be ordered by their canonical index positions",
        )

    for k in range(len(sorted_by_ci) - 1):
        _, curr = sorted_by_ci[k]
        _, nxt = sorted_by_ci[k + 1]
        if curr.end_canonical_index >= nxt.start_canonical_index:
            raise HTTPException(
                status_code=400,
                detail="Explicit nodes have overlapping canonical index spans",
            )

    # Hierarchy validation
    has_h1 = False
    has_h2 = False
    for i, node in enumerate(nodes):
        if node.node_type == "h1":
            has_h1 = True
            has_h2 = False
        elif node.node_type == "h2":
            if not has_h1:
                raise HTTPException(
                    status_code=400,
                    detail=f"Node at index {i} (h2) must be preceded by an h1",
                )
            has_h2 = True
        elif node.node_type == "h3":
            if not has_h2:
                raise HTTPException(
                    status_code=400,
                    detail=f"Node at index {i} (h3) must be preceded by an h2",
                )


@router.get("/{chatroom_id}", response_model=NodesState)
def get_nodes(chatroom_id: int):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id = _resolve_doc(chatroom_id)
    if document_id is None:
        return NodesState(chatroom_id=chatroom_id, has_canonical_words=False)

    has_cw = _has_canonical_words(document_id)
    committed_nodes = _load_committed(document_id)

    return NodesState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_canonical_words=has_cw,
        committed_nodes=committed_nodes,
    )


@router.post("/{chatroom_id}/commit", response_model=NodesState)
def commit_nodes(chatroom_id: int, body: CommitNodesRequest):
    if not _chatroom_exists(chatroom_id):
        raise HTTPException(status_code=404, detail="Chatroom not found")

    document_id = _resolve_doc(chatroom_id)
    if document_id is None:
        raise HTTPException(status_code=400, detail="No document for chatroom")

    _validate_nodes(body.nodes)
    parents = _compute_parents(body.nodes)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM document_nodes WHERE document_id = %s",
                (document_id,),
            )
            if body.nodes:
                row_ph = "(%s,%s,%s,%s,%s,%s,%s)"
                placeholders = ",".join([row_ph] * len(body.nodes))
                flat: list = []
                for i, (node, parent) in enumerate(zip(body.nodes, parents)):
                    flat.extend([
                        document_id, i, parent,
                        node.node_type, node.label,
                        node.start_canonical_index, node.end_canonical_index,
                    ])
                cur.execute(
                    f"""INSERT INTO document_nodes
                        (document_id, node_index, parent_node, node_type, label,
                         start_canonical_index, end_canonical_index)
                        VALUES {placeholders}""",
                    flat,
                )

    return NodesState(
        chatroom_id=chatroom_id,
        document_id=document_id,
        has_canonical_words=True,
        committed_nodes=body.nodes if body.nodes else None,
    )
