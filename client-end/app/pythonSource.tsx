import { Fragment, type ReactNode } from "react";

const KEYWORDS = new Set(["def", "return", "import", "from", "if", "not", "in", "and", "or", "as", "class", "None", "True", "False", "with", "for", "else", "elif"]);
const TYPES = new Set(["bool", "str", "int", "t", "Response", "BaseResponse"]);

/** Tiny Python highlighter for the editor preview. Pure React nodes; no HTML strings. */
export function highlightPython(line: string): ReactNode {
  if (line.trim().startsWith("#")) return <span className="syn-com">{line}</span>;
  const out: ReactNode[] = [];
  const re = /("""|"[^"]*"|'[^']*'|``[^`]*``|:envvar:`[^`]*`|@\w+|\b\d+\b|\b[A-Za-z_]\w*\b|\s+|.)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  let afterDef = false;
  while ((m = re.exec(line))) {
    const tok = m[0];
    const key = i++;
    if (tok.startsWith('"') || tok.startsWith("'")) out.push(<span key={key} className="syn-str">{tok}</span>);
    else if (tok.startsWith("@")) out.push(<span key={key} className="syn-deco">{tok}</span>);
    else if (/^\d+$/.test(tok)) out.push(<span key={key} className="syn-num">{tok}</span>);
    else if (KEYWORDS.has(tok)) {
      afterDef = tok === "def";
      out.push(<span key={key} className="syn-kw">{tok}</span>);
    } else if (afterDef && /^[A-Za-z_]/.test(tok)) {
      afterDef = false;
      out.push(<span key={key} className="syn-fn">{tok}</span>);
    } else if (TYPES.has(tok)) out.push(<span key={key} className="syn-ty">{tok}</span>);
    else out.push(<Fragment key={key}>{tok}</Fragment>);
  }
  return out;
}

/** Lines 1–26 and the rest of helpers.py around get_debug_flag (illustrative content). */
export const FILE_HEAD = `from __future__ import annotations

import importlib.util
import os
import sys
import typing as t
from datetime import datetime
from functools import cache
from functools import update_wrapper

import werkzeug.utils
from werkzeug.exceptions import abort as _wz_abort
from werkzeug.utils import redirect as _wz_redirect
from werkzeug.wrappers import Response as BaseResponse

from .globals import _cv_request
from .globals import current_app
from .globals import request
from .globals import request_ctx
from .globals import session
from .signals import message_flashed

if t.TYPE_CHECKING:  # pragma: no cover
    from .wrappers import Response

`.split("\n").slice(0, 26);

export const FUNC_ORIGINAL = [
  "def get_debug_flag() -> bool:",
  '    """Get whether debug mode should be enabled for the app, indicated by the',
  "    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.",
  '    """',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no"})',
];

export const FUNC_UPDATED = [
  "def get_debug_flag() -> bool:",
  '    """Get whether debug mode should be enabled for the app, indicated by the',
  "    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.",
  "",
  '    The values ``"0"``, ``"false"``, ``"no"``, ``"off"`` and ``"n"`` (case-',
  "    insensitive) are treated as false; anything else that is set is true.",
  '    """',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})',
];
/** 0-based indexes in FUNC_UPDATED that are new or changed. */
export const FUNC_UPDATED_MARKS = new Set([3, 4, 5, 8]);

export const FILE_TAIL = [
  "",
  "",
  "def get_load_dotenv(default: bool = True) -> bool:",
  '    """Get whether the user has disabled loading default dotenv files by',
  "    setting :envvar:`FLASK_SKIP_DOTENV`. The default is ``True``, load",
  "    the files.",
  "",
  "    :param default: What to return if the env var isn't set.",
  '    """',
  '    val = os.environ.get("FLASK_SKIP_DOTENV")',
  "",
  "    if not val:",
  "        return default",
  "",
  '    return val.lower() in ("0", "false", "no")',
];
