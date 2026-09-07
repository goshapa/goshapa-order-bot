from aiogram.fsm.state import State, StatesGroup


class OrderForm(StatesGroup):
    choosing_service = State()
    choosing_package = State()
    viewing_package = State()
    answering_survey = State()
    preview = State()
