import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.auth import router as auth_router
from routers.chatrooms import router as chatrooms_router
from routers.config import router as config_router
from routers.raw_words import router as raw_words_router
from routers.canonical_words import router as canonical_words_router
from routers.nodes import router as nodes_router
from routers.chunks import router as chunks_router

app = FastAPI()

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth")
app.include_router(chatrooms_router, prefix="/chatrooms")
app.include_router(config_router, prefix="/config")
app.include_router(raw_words_router, prefix="/raw-words")
app.include_router(canonical_words_router, prefix="/canonical-words")
app.include_router(nodes_router, prefix="/nodes")
app.include_router(chunks_router, prefix="/chunks")
