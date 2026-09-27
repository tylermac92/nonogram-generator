import pytest


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    # Treat "no tests collected" as success so an empty suite passes.
    if exitstatus == pytest.ExitCode.NO_TESTS_COLLECTED:
        session.exitstatus = pytest.ExitCode.OK
