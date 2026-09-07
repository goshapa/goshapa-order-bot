from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, FSInputFile

from content.packages import (
    BUNDLE_IMAGES,
    SERVICE_LABELS,
    format_package_caption,
    format_package_details,
)
from handlers.start import WELCOME_TEXT
from keyboards.inline import main_menu_kb, package_card_kb, packages_kb
from states.order import OrderForm

router = Router(name="menu")


async def _delete_package_photo(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    photo_msg_id = data.get("package_photo_msg_id")
    if photo_msg_id:
        try:
            await callback.bot.delete_message(callback.message.chat.id, photo_msg_id)
        except Exception:
            pass


@router.callback_query(OrderForm.choosing_service, F.data.startswith("service:"))
async def choose_service(callback: CallbackQuery, state: FSMContext) -> None:
    service = callback.data.split(":")[1]
    await state.update_data(service=service)
    await state.set_state(OrderForm.choosing_package)

    label = SERVICE_LABELS[service]
    await callback.message.delete()
    await callback.message.answer(
        f"{label}\n\nВыберите пакет — при открытии увидите картинку, описание и список возможностей.",
        reply_markup=packages_kb(service),
    )
    await callback.answer()


@router.callback_query(F.data == "back:main_menu")
async def back_to_main_menu(callback: CallbackQuery, state: FSMContext) -> None:
    await state.set_data({})
    await state.set_state(OrderForm.choosing_service)
    await callback.message.delete()
    await callback.message.answer(WELCOME_TEXT, reply_markup=main_menu_kb())
    await callback.answer()


@router.callback_query(F.data.startswith("back:packages:"))
async def back_to_packages(callback: CallbackQuery, state: FSMContext) -> None:
    service = callback.data.split(":")[2]
    await _delete_package_photo(callback, state)
    await state.update_data(service=service, package_photo_msg_id=None)
    await state.set_state(OrderForm.choosing_package)
    await callback.message.delete()
    await callback.message.answer(
        f"{SERVICE_LABELS[service]}\n\nВыберите пакет:",
        reply_markup=packages_kb(service),
    )
    await callback.answer()


@router.callback_query(OrderForm.choosing_package, F.data.startswith("package:"))
async def show_package(callback: CallbackQuery, state: FSMContext) -> None:
    _, service, bundle = callback.data.split(":")
    await state.update_data(service=service, bundle=bundle)
    await state.set_state(OrderForm.viewing_package)

    photo = FSInputFile(BUNDLE_IMAGES[bundle])

    await callback.message.delete()
    photo_msg = await callback.message.answer_photo(
        photo=photo,
        caption=format_package_caption(service, bundle),
    )
    await state.update_data(package_photo_msg_id=photo_msg.message_id)
    await callback.message.answer(
        format_package_details(service, bundle),
        reply_markup=package_card_kb(service, bundle),
    )
    await callback.answer()
