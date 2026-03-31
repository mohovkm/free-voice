"""Push notification string table — server-side i18n for EN and RU."""

_STRINGS: dict[str, dict[str, str]] = {
    "en": {
        "push_photo": "Photo",
        "push_voice": "Voice message",
        "push_video": "Video message",
        "push_attachment": "Attachment",
        "push_call_video": "Incoming video call",
        "push_call_audio": "Incoming call",
        "push_contact_request": "Contact request",
    },
    "ru": {
        "push_photo": "Фото",
        "push_voice": "Голосовое сообщение",
        "push_video": "Видеосообщение",
        "push_attachment": "Вложение",
        "push_call_video": "Входящий видеозвонок",
        "push_call_audio": "Входящий звонок",
        "push_contact_request": "Запрос контакта",
    },
}


def t(key: str, lang: str) -> str:
    """Return the localized string for key in lang, falling back to English."""
    return _STRINGS.get(lang, _STRINGS["en"]).get(key, _STRINGS["en"][key])
