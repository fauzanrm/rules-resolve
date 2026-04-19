import os
from typing import Optional

from supabase import create_client

BUCKET = "chatroom-assets"
SIGNED_URL_EXPIRY = 31536000  # 1 year


def get_supabase():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        return None
    return create_client(url, key)


def get_signed_url(supabase, path: str) -> Optional[str]:
    try:
        result = supabase.storage.from_(BUCKET).create_signed_url(path, expires_in=SIGNED_URL_EXPIRY)
        return result.get("signedURL")
    except Exception:
        return None


def upload_file(supabase, path: str, data: bytes, content_type: str) -> None:
    supabase.storage.from_(BUCKET).upload(path, data, {"content-type": content_type, "upsert": "true"})
