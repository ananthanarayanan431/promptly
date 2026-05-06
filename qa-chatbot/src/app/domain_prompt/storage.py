from __future__ import annotations

import io
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.config.env import get_minio_settings


def _client() -> Any:  # noqa: ANN401
    s = get_minio_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.MINIO_ENDPOINT_URL,
        aws_access_key_id=s.MINIO_ACCESS_KEY,
        aws_secret_access_key=s.MINIO_SECRET_KEY.get_secret_value(),
        region_name="us-east-1",
    )


def ensure_bucket(bucket: str) -> None:
    client = _client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        client.create_bucket(Bucket=bucket)


def upload_bytes(
    bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream"
) -> None:
    ensure_bucket(bucket)
    _client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def download_bytes(bucket: str, key: str) -> bytes:
    buf = io.BytesIO()
    _client().download_fileobj(bucket, key, buf)
    buf.seek(0)
    return buf.read()


def upload_text(bucket: str, key: str, text: str, content_type: str = "text/plain") -> None:
    upload_bytes(bucket, key, text.encode("utf-8"), content_type)


def download_text(bucket: str, key: str) -> str:
    return download_bytes(bucket, key).decode("utf-8")


def object_key(user_id: str, domain_id: str, filename: str) -> str:
    return f"users/{user_id}/domains/{domain_id}/{filename}"
