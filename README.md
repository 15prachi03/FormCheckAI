# FormCheck AI

A polished Flask MVP for OCR-based document review and cross-document field comparison.

## Features
- Upload one or two PDF/JPG/PNG documents
- Extract selectable PDF text; OCR scanned PDFs and images with Tesseract
- Detect common fields: name, date of birth, email, phone, Aadhaar and application ID
- Run basic format checks and flag missing/unrecognised values
- Compare fields across two documents
- Responsive dashboard and results report

## 1. Requirements
- Python 3.10+
- Tesseract OCR installed on your computer

### Install Tesseract
- Windows: install the Tesseract OCR Windows build, then add its installation folder to PATH.
- Ubuntu/Debian: `sudo apt install tesseract-ocr`
- macOS: `brew install tesseract`

If Tesseract is installed in a custom Windows location, add this near the imports in `app.py`:
```python
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
```

## 2. Setup
```bash
python -m venv venv
```
Windows:
```bash
venv\Scripts\activate
```
macOS/Linux:
```bash
source venv/bin/activate
```
Install packages:
```bash
pip install -r requirements.txt
```

## 3. Run
```bash
python app.py
```
Open `http://127.0.0.1:5000` in your browser.

## Demo tips
Create two sample forms with clearly printed labels, for example:
- Name: Aanya Sharma
- DOB: 12/04/2005
- Email: aanya@example.com
- Phone: 9876543210

Change the DOB or phone in the second document to demonstrate inconsistency detection.

## Important limitations
This is a college-project MVP, not an official verification service. OCR accuracy depends on scan quality and layout. Field extraction uses transparent regex patterns and may miss unusual labels or handwriting. The system does not verify whether a document is genuine, nor does it submit forms. Do not upload real Aadhaar or sensitive personal documents for public demos.
