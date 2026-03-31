"""Push notification payload models."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class NotificationType(StrEnum):
    CHAT = "chat"
    CALL = "call"
    CONTACT = "contact"


@dataclass(frozen=True)
class PushNotification:
    type: NotificationType
    title: str
    from_: str
    preview: str = ""
    target: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload = {
            "type": self.type.value,
            "title": self.title,
            "from": self.from_,
            "preview": self.preview or "",
        }
        if self.target is not None:
            payload["target"] = self.target
        return payload
