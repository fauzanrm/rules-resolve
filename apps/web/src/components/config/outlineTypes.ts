export type HeadingLevel = "h1" | "h2" | "h3";

// DraftNode is client-side only; isInferred and headingLevel are UI state
export interface DraftNode {
  clientId: string;
  headingLevel: HeadingLevel | null;
  isInferred: boolean;
  label: string;
  startCanonicalIndex: number;  // 0 when isInferred
  endCanonicalIndex: number;    // 0 when isInferred
}

// Shape returned by the API (node_type IS the heading level in the actual DB schema)
export interface CommittedNodeApi {
  node_type: HeadingLevel;
  label: string;
  start_canonical_index: number;
  end_canonical_index: number;
}

export interface NodesApiResponse {
  chatroom_id: number;
  document_id: number | null;
  has_canonical_words: boolean;
  committed_nodes: CommittedNodeApi[] | null;
}

export function committedToDraft(node: CommittedNodeApi): DraftNode {
  const isInferred = node.start_canonical_index === 0 && node.end_canonical_index === 0;
  return {
    clientId: crypto.randomUUID(),
    headingLevel: node.node_type,
    isInferred,
    label: node.label,
    startCanonicalIndex: node.start_canonical_index,
    endCanonicalIndex: node.end_canonical_index,
  };
}

export function draftToApi(node: DraftNode) {
  return {
    node_type: node.headingLevel,
    label: node.label,
    start_canonical_index: node.isInferred ? 0 : node.startCanonicalIndex,
    end_canonical_index: node.isInferred ? 0 : node.endCanonicalIndex,
  };
}

export function levelToNum(level: HeadingLevel | null): number {
  if (level === "h1") return 1;
  if (level === "h2") return 2;
  if (level === "h3") return 3;
  return 0;
}

export function numToLevel(n: number): HeadingLevel | null {
  if (n === 1) return "h1";
  if (n === 2) return "h2";
  if (n === 3) return "h3";
  return null;
}

export function getNodeSubtree(nodes: DraftNode[], headId: string): DraftNode[] {
  const headIdx = nodes.findIndex((n) => n.clientId === headId);
  if (headIdx === -1) return [];
  const head = nodes[headIdx];
  const headLevel = levelToNum(head.headingLevel);
  if (headLevel === 0) return [head];
  const result: DraftNode[] = [head];
  for (let i = headIdx + 1; i < nodes.length; i++) {
    if (levelToNum(nodes[i].headingLevel) > headLevel) {
      result.push(nodes[i]);
    } else {
      break;
    }
  }
  return result;
}

export function validateHierarchy(nodes: DraftNode[]): string | null {
  let hasH1 = false;
  let hasH2 = false;
  for (const node of nodes) {
    if (!node.headingLevel) continue;
    if (node.headingLevel === "h1") {
      hasH1 = true;
      hasH2 = false;
    } else if (node.headingLevel === "h2") {
      if (!hasH1) return "An h2 cannot appear before any h1";
      hasH2 = true;
    } else if (node.headingLevel === "h3") {
      if (!hasH2) return "An h3 cannot appear before any h2";
    }
  }
  return null;
}
