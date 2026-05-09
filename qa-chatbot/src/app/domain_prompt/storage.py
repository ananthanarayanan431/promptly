from __future__ import annotations

import io
from functools import lru_cache
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.config.env import get_minio_settings


@lru_cache(maxsize=1)
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
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("404", "NoSuchBucket"):
            client.create_bucket(Bucket=bucket)
        else:
            raise


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


def delete_objects_with_prefix(bucket: str, prefix: str) -> None:
    """Delete all objects under the given prefix. Silently skips if bucket is missing."""
    client = _client()
    try:
        paginator = client.get_paginator("list_objects_v2")
        keys = [
            {"Key": obj["Key"]}
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix)
            for obj in page.get("Contents", [])
        ]
        for i in range(0, len(keys), 1000):
            client.delete_objects(Bucket=bucket, Delete={"Objects": keys[i : i + 1000]})
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in ("NoSuchBucket", "NotFound", "404"):
            raise


def object_key(user_id: str, domain_id: str, filename: str) -> str:
    return f"users/{user_id}/domains/{domain_id}/{filename}"
