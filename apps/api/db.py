import os
import psycopg2
from psycopg2 import pool

_pool = None


def _get_pool():
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
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
    conn = conn_pool.getconn()
    return _PooledConnection(conn_pool, conn)