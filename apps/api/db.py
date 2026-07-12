import os
import time
import psycopg2
from psycopg2 import pool

_pool = None

# DATABASE_URL points at Supabase's session-mode pooler, which enforces its own
# hard server-side cap of 15 concurrent client connections regardless of what we
# ask for here — stay comfortably under that rather than trying to out-provision it.
_MAXCONN = 10
_GETCONN_TIMEOUT_SECONDS = 5
_GETCONN_RETRY_DELAY_SECONDS = 0.1


def _get_pool():
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=_MAXCONN,
            dsn=os.environ["DATABASE_URL"],
        )
    return _pool


class _PooledConnection:
    """Wraps a pooled connection so `with get_connection() as conn:` keeps working:
    commits/rolls back the transaction like a native psycopg2 connection context
    manager, but returns the connection to the pool instead of leaking a socket."""

    def __init__(self, conn_pool, conn):
        self._pool = conn_pool
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._pool.putconn(self._conn)
        return False


def get_connection():
    conn_pool = _get_pool()
    deadline = time.monotonic() + _GETCONN_TIMEOUT_SECONDS
    while True:
        try:
            conn = conn_pool.getconn()
            return _PooledConnection(conn_pool, conn)
        except psycopg2.pool.PoolError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(_GETCONN_RETRY_DELAY_SECONDS)


def unpublish_chatroom(cur, chatroom_id: int) -> None:
    """Clear a chatroom's published state.

    Call this from any pipeline-stage commit endpoint (PDF, raw words,
    canonical words, nodes, chunks, embeddings) so a published Ask session
    never keeps serving answers grounded in upstream data that just changed.
    """
    cur.execute(
        "UPDATE chatrooms SET published_at = NULL WHERE id = %s AND published_at IS NOT NULL",
        (chatroom_id,),
    )