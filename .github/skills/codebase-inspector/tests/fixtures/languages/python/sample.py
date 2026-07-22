from .formatting import format_name

class Greeter(BaseGreeter):
    prefix: str

    def __init__(self, prefix: str):
        self.prefix = prefix

    async def greet(self, name: str = "secret") -> str:
        return format_name(self.prefix + name)

def add(left: int, right: int) -> int:
    return left + right
