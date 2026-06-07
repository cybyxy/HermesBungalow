import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Union
import ast
import operator

app = FastAPI(title="Calculator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CalcRequest(BaseModel):
    expression: str = Field(..., min_length=1, max_length=200)


class CalcResponse(BaseModel):
    result: str


class HistoryItem(BaseModel):
    expression: str
    result: str


_history: list[HistoryItem] = []

# Allowed operators
ALLOWED_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
}

# Safe pattern: only numbers, basic operators, dots, parens
SAFE_RE = re.compile(r'^[\d+\-*/().\s%]+$')


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "calculator-api"}


@app.post("/api/calc")
async def calculate(req: CalcRequest):
    expr = req.expression.strip()

    if not SAFE_RE.match(expr):
        raise HTTPException(status_code=400, detail="非法字符: 只允许数字、+、-、*、/、(、)、.、空格")

    # Normalize visual symbols
    expr = expr.replace('×', '*').replace('÷', '/').replace('−', '-')

    # Handle percentage
    def _replace_pct(m: re.Match) -> str:
        return f"({m.group(1)} / 100)"

    expr = re.sub(r'([\d.]+)%', _replace_pct, expr)

    try:
        tree = ast.parse(expr, mode='eval')
        result = _eval_node(tree.body)
        # Format result
        if isinstance(result, float):
            if result == int(result) and abs(result) < 1e15:
                result_str = str(int(result))
            else:
                result_str = f"{result:.10f}".rstrip('0').rstrip('.')
        else:
            result_str = str(result)

        _history.append(HistoryItem(expression=req.expression, result=result_str))
        return CalcResponse(result=result_str)

    except ZeroDivisionError:
        raise HTTPException(status_code=400, detail="除数不能为零")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"表达式错误: {str(e)}")


@app.get("/api/history")
async def get_history(limit: int = 20):
    return {"history": _history[-limit:]}


def _eval_node(node: ast.AST) -> Union[int, float]:
    """Recursively evaluate an AST node safely."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError(f"不允许的类型: {type(node.value)}")
    elif isinstance(node, ast.BinOp):
        op_func = ALLOWED_OPS.get(type(node.op))
        if not op_func:
            raise ValueError(f"不允许的操作: {type(node.op).__name__}")
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        return op_func(left, right)
    elif isinstance(node, ast.UnaryOp):
        op_func = ALLOWED_OPS.get(type(node.op))
        if not op_func:
            raise ValueError(f"不允许的运算符: {type(node.op).__name__}")
        operand = _eval_node(node.operand)
        return op_func(operand)
    elif isinstance(node, ast.Expression):
        return _eval_node(node.body)
    else:
        raise ValueError(f"不允许的节点类型: {type(node).__name__}")


if __name__ == "__main__":
    import uvicorn
    port = 4001
    uvicorn.run(app, host="0.0.0.0", port=port)
