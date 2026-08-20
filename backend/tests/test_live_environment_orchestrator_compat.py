from inspect import signature

from app.services.live_environment import get_live_environment


def test_live_environment_accepts_timezone_name_from_orchestrators() -> None:
    parameters = signature(get_live_environment).parameters
    assert "timezone_name" in parameters
    assert parameters["timezone_name"].default is None
