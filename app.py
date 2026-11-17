import os
import re
import uuid
import json
import sqlite3
from datetime import datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for, abort
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import fitz
from PIL import Image
import pytesseract


BASE_DIR = os.path.abspath(os.path.dirname(__file__))

DATA_DIR = os.environ.get("FORMCHECK_DATA_DIR", BASE_DIR)

UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
DB_PATH = os.path.join(DATA_DIR, "formcheck.db")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)


app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = UPLOAD_DIR
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024
ALLOWED = {"pdf", "png", "jpg", "jpeg"}
REQUIRED_FIELDS = ["Full name", "Date of birth", "Email", "Phone"]

FIELD_PATTERNS = {
    "Full name": [
        r"(?:full name|student name|applicant name|name)\s*[:\-]?\s*([A-Za-z][A-Za-z .'-]{1,60})"
    ],
    "Date of birth": [
        r"(?:date of birth|dob|birth date)\s*[:\-]?\s*([0-9./-]{6,12})"
    ],
    "Email": [r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"],
    "Phone": [
        r"(?:phone|mobile|contact|telephone)(?:\s+(?:number|no\.?))?\s*[:\-]?\s*(\+?\d[\d\s-]{7,18}\d)",
        r"\b([6-9]\d{9})\b"
    ],
    "Aadhaar": [r"\b(\d{4}\s?\d{4}\s?\d{4})\b"],
    "Application ID": [
        r"(?:application id|registration no|application number|student id)\s*[:\-]?\s*([A-Za-z0-9/-]{4,})"
    ]
}

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                document_count INTEGER NOT NULL,
                filenames TEXT NOT NULL,
                score INTEGER NOT NULL,
                errors INTEGER NOT NULL,
                warnings INTEGER NOT NULL,
                passed INTEGER NOT NULL,
                report_json TEXT NOT NULL
            )
        """)
        conn.commit()

init_db()

def allowed_file(name):
    return "." in name and name.rsplit(".", 1)[1].lower() in ALLOWED

def extract_text(path):
    ext = path.rsplit(".", 1)[1].lower()
    if ext == "pdf":
        doc = fitz.open(path)
        try:
            text = "\n".join(page.get_text() for page in doc)
            if len(text.strip()) < 30:
                chunks = []
                for page in doc:
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                    image_path = path + f"_page{page.number}.png"
                    try:
                        pix.save(image_path)
                        with Image.open(image_path) as image:
                            chunks.append(pytesseract.image_to_string(image))
                    finally:
                        if os.path.exists(image_path):
                            os.remove(image_path)
                text = "\n".join(chunks)
            return text
        finally:
            doc.close()
    with Image.open(path) as image:
        return pytesseract.image_to_string(image)

def extract_fields(text):
    found = {}
    for label, patterns in FIELD_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if match:
                value = match.group(1) if match.lastindex else match.group(0)
                found[label] = re.sub(r"\s+", " ", value).strip(" :.-")
                break
    return found

def parse_dob(value):
    for date_format in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y",
                        "%d/%m/%y", "%d-%m-%y", "%d.%m.%y"):
        try:
            return datetime.strptime(value, date_format).date()
        except ValueError:
            pass
    return None

def validate_fields(fields):
    errors, warnings, passed = [], [], []
    for label in REQUIRED_FIELDS:
        if not fields.get(label):
            warnings.append({"field": label, "message": f"{label} is missing or could not be detected.", "severity": "warning"})
    if fields.get("Full name"):
        passed.append({"field": "Full name", "message": "Name detected."})
    dob = fields.get("Date of birth")
    if dob:
        if parse_dob(dob):
            passed.append({"field": "Date of birth", "message": f"Valid date detected: {dob}"})
        else:
            errors.append({"field": "Date of birth", "message": f"Invalid date: {dob}. Use DD/MM/YYYY.", "severity": "error"})
    email = fields.get("Email")
    if email:
        if re.fullmatch(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", email):
            passed.append({"field": "Email", "message": "Email format looks valid."})
        else:
            errors.append({"field": "Email", "message": "Invalid email address format.", "severity": "error"})
    phone = fields.get("Phone")
    if phone:
        digits = re.sub(r"\D", "", phone)
        if len(digits) == 10 and digits[0] in "6789":
            passed.append({"field": "Phone", "message": "Phone number looks valid."})
        else:
            errors.append({"field": "Phone", "message": "Phone number should be a valid 10-digit Indian mobile number.", "severity": "error"})
    for label in ("Aadhaar", "Application ID"):
        if fields.get(label):
            passed.append({"field": label, "message": f"{label} detected."})
    return passed, errors, warnings

def normalize(value):
    return re.sub(r"\W", "", str(value)).lower()

def comparable_value(field, value):
    if field == "Date of birth":
        parsed = parse_dob(value)
        if parsed:
            return parsed.isoformat()
    if field == "Phone":
        return re.sub(r"\D", "", str(value))
    return normalize(value)

def save_analysis(report):
    analysis_id = uuid.uuid4().hex[:12]
    summary = report["summary"]
    names = [d["name"] for d in report["documents"]]
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (analysis_id, report["created_at"], len(names), json.dumps(names),
             summary["score"], summary["errors"], summary["warnings"],
             summary["passed"], json.dumps(report))
        )
        conn.commit()
    report["id"] = analysis_id
    return report

@app.route("/")
def home():
    return redirect(url_for("overview"))

@app.route("/overview")
def overview():
    with sqlite3.connect(DB_PATH) as conn:
        total = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
        recent = conn.execute("SELECT id, created_at, filenames, score, errors FROM analyses ORDER BY rowid DESC LIMIT 5").fetchall()
    recent_items = [{"id": r[0], "created_at": r[1], "filenames": json.loads(r[2]), "score": r[3], "errors": r[4]} for r in recent]
    return render_template("overview.html", active="overview", total=total, recent=recent_items)

@app.route("/analyze")
def analyze_page():
    return render_template("analyze.html", active="analyze")

@app.route("/results/<analysis_id>")
def results_page(analysis_id):
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT report_json FROM analyses WHERE id=?", (analysis_id,)).fetchone()
    if not row:
        abort(404)
    return render_template("results.html", active="results", report=json.loads(row[0]), analysis_id=analysis_id)

@app.route("/history")
def history():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT id, created_at, filenames, score, errors, warnings FROM analyses ORDER BY rowid DESC").fetchall()
    items = [{"id": r[0], "created_at": r[1], "filenames": json.loads(r[2]), "score": r[3], "errors": r[4], "warnings": r[5]} for r in rows]
    return render_template("history.html", active="history", items=items)

@app.route("/library")
def library():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT id, created_at, filenames FROM analyses ORDER BY rowid DESC").fetchall()
    docs = []
    for row in rows:
        for name in json.loads(row[2]):
            docs.append({"name": name, "created_at": row[1], "analysis_id": row[0]})
    return render_template("library.html", active="library", documents=docs)

@app.route("/analytics")
def analytics():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT score, errors, warnings, passed FROM analyses").fetchall()
    stats = {"analyses": len(rows), "average_score": round(sum(r[0] for r in rows)/len(rows)) if rows else 0,
             "errors": sum(r[1] for r in rows), "warnings": sum(r[2] for r in rows),
             "passed": sum(r[3] for r in rows)}
    return render_template("analytics.html", active="analytics", stats=stats)

@app.route("/reports")
def reports():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT id, created_at, filenames, score FROM analyses ORDER BY rowid DESC").fetchall()
    items = [{"id": r[0], "created_at": r[1], "filenames": json.loads(r[2]), "score": r[3]} for r in rows]
    return render_template("reports.html", active="reports", items=items)

@app.route("/how-it-works")
def how_it_works():
    return render_template("how.html", active="how")

@app.route("/settings")
def settings():
    return render_template("settings.html", active="settings")

@app.route("/help")
def help_page():
    return render_template("help.html", active="help")

@app.route("/analyze", methods=["POST"])
def analyze_documents():
    uploaded = [f for f in request.files.getlist("documents") if f and f.filename]
    mode = request.form.get("analysis_mode", "single")

    if not uploaded:
        return jsonify({"error": "Please choose at least one document."}), 400

    if mode == "single" and len(uploaded) != 1:
        return jsonify({"error": "Single Document Validation requires exactly one filled form."}), 400
    elif mode == "cross" and len(uploaded) < 2:
        return jsonify({"error": "Cross-Document Comparison requires at least two documents."}), 400
    elif mode == "reference" and len(uploaded) != 2:
        return jsonify({"error": "Reference-Based Verification requires exactly two documents (one filled form and one reference document)."}), 400

    docs = []
    for file in uploaded:
        if not allowed_file(file.filename):
            return jsonify({"error": "Only PDF, PNG, JPG and JPEG files are supported."}), 400
        safe = secure_filename(file.filename)
        if not safe:
            return jsonify({"error": "Invalid file name."}), 400
        path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_{safe}")
        try:
            file.save(path)
            text = extract_text(path)
            fields = extract_fields(text)
            passed, errors, warnings = validate_fields(fields)
            docs.append({"name": safe, "filename": safe, "fields": fields,
                         "text_preview": text[:1400], "passed": passed,
                         "errors": errors, "warnings": warnings})
        except Exception as exc:
            return jsonify({"error": f"Could not read {safe}. Check OCR installation and file quality. Details: {str(exc)[:140]}"}), 500
        finally:
            if os.path.exists(path):
                os.remove(path)

    inconsistencies = []

    if mode == "cross" and len(docs) >= 2:
        # Compare first document with all subsequent documents
        for i in range(1, len(docs)):
            common = set(docs[0]["fields"]) & set(docs[i]["fields"])
            for field in sorted(common):
                first, other = docs[0]["fields"][field], docs[i]["fields"][field]
                if comparable_value(field, first) != comparable_value(field, other):
                    inconsistencies.append({
                        "field": field, "first": first, "second": other,
                        "values": [{"filename": docs[0]["filename"], "value": first},
                                   {"filename": docs[i]["filename"], "value": other}],
                        "message": f"{field} differs between {docs[0]['filename']} and {docs[i]['filename']}."
                    })
    elif mode == "reference" and len(docs) == 2:
        form_doc = docs[0]
        ref_doc = docs[1]
        # Check form against reference document
        ref_fields = ref_doc["fields"]
        form_fields = form_doc["fields"]
        for field, ref_val in ref_fields.items():
            form_val = form_fields.get(field)
            if not form_val:
                form_doc["warnings"].append({"field": field, "message": f"Reference expects '{field}' but it was missing in the form.", "severity": "warning"})
            elif comparable_value(field, form_val) != comparable_value(field, ref_val):
                inconsistencies.append({
                    "field": field, "first": form_val, "second": ref_val,
                    "values": [{"filename": form_doc["filename"], "value": form_val},
                               {"filename": ref_doc["filename"], "value": ref_val}],
                    "message": f"{field} in form ({form_val}) does not match reference guideline ({ref_val})."
                })

    total_errors = sum(len(d["errors"]) for d in docs)
    total_warnings = sum(len(d["warnings"]) for d in docs)
    total_passed = sum(len(d["passed"]) for d in docs)
    mismatch_count = len(inconsistencies)
    issue_count = total_errors + total_warnings + mismatch_count
    total_checks = total_passed + issue_count
    score = round((total_passed / total_checks) * 100) if total_checks else 0

    categories = {"Missing fields": 0, "Invalid email": 0, "Invalid phone": 0,
                  "Invalid date": 0, "Document mismatches": mismatch_count, "Other issues": 0}
    for doc in docs:
        for warning in doc["warnings"]:
            if "missing" in warning["message"].lower():
                categories["Missing fields"] += 1
        for error in doc["errors"]:
            field = error["field"]
            if field == "Email": categories["Invalid email"] += 1
            elif field == "Phone": categories["Invalid phone"] += 1
            elif field == "Date of birth": categories["Invalid date"] += 1
            else: categories["Other issues"] += 1

    report = {"success": True, "analysis_mode": mode, "documents": docs, "mismatches": inconsistencies,
              "inconsistencies": inconsistencies,
              "summary": {"errors": total_errors + mismatch_count, "warnings": total_warnings,
                          "passed": total_passed, "score": score, "total_checks": total_checks},
              "analytics": categories,
              "created_at": datetime.now().strftime("%d %b %Y · %I:%M %p")}
    report = save_analysis(report)
    return jsonify(report)

@app.route("/api/validate-online-form", methods=["POST"])
def validate_online_form():
    data = request.get_json(silent=True) or {}
    fields = data.get("fields")

    if not isinstance(fields, list):
        return jsonify({"error": "Invalid form data."}), 400

    if len(fields) > 500:
        return jsonify({"error": "Too many form fields."}), 400

    results = []

    for index, field in enumerate(fields):
        if not isinstance(field, dict):
            continue

        name = str(field.get("name") or f"Field {index + 1}")
        field_type = str(field.get("type") or "text").lower()
        value = str(field.get("value") or "").strip()
        required = bool(field.get("required", False))
        checked = bool(field.get("checked", False))
        browser_valid = field.get("valid", True)

        status = "valid"
        message = "Information looks valid."

        # Checkbox validation
        if field_type == "checkbox":
            if not checked and required:
                status = "invalid"
                message = "Please check this box."
            elif not checked:
                status = "skipped"
                message = "Optional checkbox is not selected."

        # Radio button group validation
        elif field_type == "radio":
            if not value and required:
                status = "invalid"
                message = "Please select an option."
            elif not value:
                status = "skipped"
                message = "Optional selection is empty."
            else:
                message = "An option is selected."

        # Required field validation
        elif not value and required:
            status = "invalid"
            message = "Required field is missing."

        # Optional empty field
        elif not value:
            status = "skipped"
            message = "Optional field is empty."

        # Email validation
        elif field_type == "email":
            if not re.fullmatch(
                r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
                value
            ):
                status = "invalid"
                message = "Invalid email address."

        # Name validation
        elif field_type == "text" and re.search(r"name", name, re.I):
            if len(value) < 2 or re.search(r"\d", value):
                status = "invalid"
                message = "Please enter a valid name."

        # Date of birth validation
        elif field_type == "date" and re.search(
            r"birth|dob", name, re.I
        ):
            try:
                entered_date = datetime.strptime(
                    value, "%Y-%m-%d"
                ).date()

                if entered_date > datetime.now().date():
                    status = "invalid"
                    message = "Date of birth cannot be in the future."

            except ValueError:
                status = "invalid"
                message = "Invalid date."

        # Phone validation
        elif field_type == "tel":
            digits = re.sub(r"\D", "", value)

            if len(digits) < 7 or len(digits) > 15:
                status = "invalid"
                message = "Invalid phone number length."

        # Other browser validation rules
        elif browser_valid is False:
            status = "invalid"
            message = "Invalid value."

        results.append({
            "name": name,
            "status": status,
            "message": message
        })

    return jsonify({
        "success": True,
        "totalFields": len(results),
        "issuesCount": sum(
            1 for item in results if item["status"] == "invalid"
        ),
        "validCount": sum(
            1 for item in results if item["status"] == "valid"
        ),
        "results": results
    })


@app.route("/api/history")
def api_history():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("SELECT id, created_at, filenames, score, errors, warnings FROM analyses ORDER BY rowid DESC").fetchall()
    return jsonify([{"id": r[0], "created_at": r[1], "filenames": json.loads(r[2]), "score": r[3], "errors": r[4], "warnings": r[5]} for r in rows])

@app.errorhandler(RequestEntityTooLarge)
def too_large(_):
    return jsonify({"error": "File too large. Maximum request size is 30 MB."}), 413

if __name__ == "__main__":
    app.run(debug=True)