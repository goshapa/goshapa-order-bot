from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from content.packages import BUNDLE_LABELS, BUNDLE_ORDER


def main_menu_kb() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="🌐 Заказать сайт", callback_data="service:website")
    builder.button(text="🤖 Заказать Telegram-бота", callback_data="service:bot")
    builder.adjust(1)
    return builder.as_markup()


def packages_kb(service: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for bundle in BUNDLE_ORDER:
        builder.button(
            text=BUNDLE_LABELS[bundle],
            callback_data=f"package:{service}:{bundle}",
        )
    builder.button(text="⬅️ Назад", callback_data="back:main_menu")
    builder.adjust(2, 2, 1)
    return builder.as_markup()


def package_card_kb(service: str, bundle: str) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Заказать", callback_data=f"order:start:{service}:{bundle}")
    builder.button(text="⬅️ Назад", callback_data=f"back:packages:{service}")
    builder.adjust(1)
    return builder.as_markup()


def cancel_kb() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="❌ Отменить", callback_data="survey:cancel")
    return builder.as_markup()


def preview_kb() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Готово", callback_data="preview:confirm")
    builder.button(text="✏️ Заполнить заново", callback_data="preview:restart")
    builder.button(text="❌ Отменить", callback_data="preview:cancel")
    builder.adjust(1)
    return builder.as_markup()


def admin_contact_kb(telegram_id: int, username: str | None) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    if username:
        url = f"https://t.me/{username}"
    else:
        url = f"tg://user?id={telegram_id}"
    builder.button(text="💬 Написать клиенту", url=url)
    return builder.as_markup()
