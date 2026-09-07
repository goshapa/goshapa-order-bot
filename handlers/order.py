from datetime import datetime

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from config import ADMIN_ID
from content.packages import BUNDLE_LABELS, SERVICE_LABELS, SURVEY_QUESTIONS
from database.db import create_order
from handlers.start import WELCOME_TEXT
from keyboards.inline import admin_contact_kb, cancel_kb, main_menu_kb, preview_kb
from states.order import OrderForm

router = Router(name="order")


def _question_text(service: str, index: int) -> str:
    q = SURVEY_QUESTIONS[service][index]
    text = f"<b>{q['question']}</b>"
    if q.get("hint"):
        text += f"\n<i>{q['hint']}</i>"
    return text


async def _send_question(message: Message, service: str, index: int) -> None:
    await message.answer(_question_text(service, index), reply_markup=cancel_kb())


def _build_preview(service: str, bundle: str, answers: dict) -> str:
    lines = [
        "<b>Проверьте вашу заявку:</b>",
        f"Услуга: {SERVICE_LABELS[service]}",
        f"Пакет: {BUNDLE_LABELS[bundle]}",
        "",
    ]
    for q in SURVEY_QUESTIONS[service]:
        answer = answers.get(q["key"], "—")
        lines.append(f"<b>{q['question']}</b>\n{answer}\n")
    return "\n".join(lines).strip()


def _build_admin_notification(
    order_number: str,
    full_name: str,
    username: str | None,
    telegram_id: int,
    service: str,
    bundle: str,
    answers: dict,
) -> str:
    lines = [
        f"🆕 <b>Новая заявка {order_number}</b>",
        "",
        f"👤 Клиент: {full_name}",
        f"Username: @{username}" if username else "Username: —",
        f"Telegram ID: <code>{telegram_id}</code>",
        f"Услуга: {SERVICE_LABELS[service]}",
        f"Пакет: {BUNDLE_LABELS[bundle]}",
        f"Дата: {datetime.now().strftime('%d.%m.%Y %H:%M')}",
        "Статус: New",
        "",
    ]
    for q in SURVEY_QUESTIONS[service]:
        answer = answers.get(q["key"], "—")
        lines.append(f"<b>{q['question']}</b>\n{answer}\n")
    return "\n".join(lines).strip()


@router.callback_query(OrderForm.viewing_package, F.data.startswith("order:start:"))
async def start_survey(callback: CallbackQuery, state: FSMContext) -> None:
    _, _, service, bundle = callback.data.split(":")

    data = await state.get_data()
    photo_msg_id = data.get("package_photo_msg_id")
    if photo_msg_id:
        try:
            await callback.bot.delete_message(callback.message.chat.id, photo_msg_id)
        except Exception:
            pass

    await state.update_data(
        service=service, bundle=bundle, answers={}, q_index=0, package_photo_msg_id=None
    )
    await state.set_state(OrderForm.answering_survey)

    await callback.message.delete()
    await _send_question(callback.message, service, 0)
    await callback.answer()


@router.message(OrderForm.answering_survey, F.text)
async def handle_survey_answer(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    service = data["service"]
    q_index = data["q_index"]
    answers = data["answers"]

    question_key = SURVEY_QUESTIONS[service][q_index]["key"]
    answers[question_key] = message.text.strip()
    q_index += 1

    if q_index < len(SURVEY_QUESTIONS[service]):
        await state.update_data(answers=answers, q_index=q_index)
        await _send_question(message, service, q_index)
    else:
        await state.update_data(answers=answers, q_index=q_index)
        await state.set_state(OrderForm.preview)
        preview_text = _build_preview(service, data["bundle"], answers)
        await message.answer(preview_text, reply_markup=preview_kb())


@router.message(OrderForm.answering_survey)
async def handle_survey_non_text(message: Message) -> None:
    await message.answer("Пожалуйста, ответьте текстовым сообщением.", reply_markup=cancel_kb())


@router.callback_query(OrderForm.preview, F.data == "preview:restart")
async def restart_survey(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    service = data["service"]
    await state.update_data(answers={}, q_index=0)
    await state.set_state(OrderForm.answering_survey)

    await callback.message.delete()
    await _send_question(callback.message, service, 0)
    await callback.answer()


@router.callback_query(F.data.in_({"preview:cancel", "survey:cancel"}))
async def cancel_survey(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_data({})
    await state.set_state(OrderForm.choosing_service)
    await callback.message.delete()
    await callback.message.answer(
        "🗑 Черновик заявки удалён.\n\n" + WELCOME_TEXT, reply_markup=main_menu_kb()
    )
    await callback.answer()


@router.callback_query(OrderForm.preview, F.data == "preview:confirm")
async def confirm_order(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    service = data["service"]
    bundle = data["bundle"]
    answers = data["answers"]

    user = callback.from_user
    order_number = await create_order(
        telegram_id=user.id,
        username=user.username,
        full_name=user.full_name,
        service=service,
        bundle=bundle,
        answers=answers,
    )

    await state.set_data({})
    await state.set_state(OrderForm.choosing_service)

    await callback.message.delete()
    await callback.message.answer(
        "✅ Заявка успешно отправлена! Программист Goshapa свяжется с вами в скором времени, "
        "чтобы обсудить дальнейшие детали проекта.\n\n"
        f"Номер вашей заявки: <b>{order_number}</b>",
        reply_markup=main_menu_kb(),
    )
    await callback.answer()

    notification = _build_admin_notification(
        order_number=order_number,
        full_name=user.full_name,
        username=user.username,
        telegram_id=user.id,
        service=service,
        bundle=bundle,
        answers=answers,
    )
    await callback.bot.send_message(
        ADMIN_ID,
        notification,
        reply_markup=admin_contact_kb(user.id, user.username),
    )
