from aiogram import Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from keyboards.inline import main_menu_kb
from states.order import OrderForm

router = Router(name="start")

WELCOME_TEXT = (
    "👋 Привет! Это бот <b>Goshapa</b> для приёма заказов на сайты и Telegram-ботов.\n\n"
    "Здесь вы можете:\n"
    "• выбрать пакет разработки сайта или Telegram-бота;\n"
    "• посмотреть, что входит в каждый пакет;\n"
    "• оставить заявку в пару шагов.\n\n"
    "Выберите, что хотите заказать 👇"
)


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(OrderForm.choosing_service)
    await message.answer(WELCOME_TEXT, reply_markup=main_menu_kb())


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(OrderForm.choosing_service)
    await message.answer("❌ Текущее действие отменено.", reply_markup=main_menu_kb())
