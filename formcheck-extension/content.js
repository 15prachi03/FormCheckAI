
if (!window.formCheckListenerAdded) {
    window.formCheckListenerAdded = true;

    window.formCheckTargets = [];

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

        // Collect form fields and send them for backend validation
        if (request.action === "CHECK_FORM") {

            const fields = Array.from(document.querySelectorAll(
                "input:not([type='hidden']):not([type='password']):not([type='submit']):not([type='button']):not([type='file']):not([type='reset']):not([type='image']), textarea, select"
            ));

            const backendFields = [];
            const targets = [];
            const processedRadios = new Set();

            // Detect whether a field is required
            function isRequiredField(field) {

                // Standard HTML required detection
                if (
                    field.required ||
                    field.hasAttribute("required") ||
                    field.getAttribute("aria-required") === "true"
                ) {
                    return true;
                }

                // Google Forms required detection
                const question = field.closest('[role="listitem"]');

                if (question) {
                    const requiredMarker = Array.from(
                        question.querySelectorAll("[aria-label]")
                    ).some(element =>
                        element.getAttribute("aria-label")
                            ?.toLowerCase() === "required question"
                    );

                    if (requiredMarker) return true;
                }

                return false;
            }

            // Detect the field's question name
            function getFieldName(field, index) {

                const question = field.closest('[role="listitem"]');

                const googleFormName = question
                    ?.innerText
                    ?.split("\n")
                    .map(text => text.trim())
                    .find(text =>
                        text &&
                        text !== "*" &&
                        !text.toLowerCase().includes("required question")
                    )
                    ?.replace(/\s*\*$/, "");

                const previousLabel =
                    field.previousElementSibling?.tagName === "LABEL"
                        ? field.previousElementSibling.innerText.trim()
                        : "";

                return (
                    field.labels?.[0]?.innerText?.trim() ||
                    previousLabel ||
                    googleFormName ||
                    field.getAttribute("aria-label") ||
                    field.name ||
                    field.placeholder ||
                    `Field ${index + 1}`
                ).replace(/:+\s*$/, "");
            }

            fields.forEach(field => {
                field.style.removeProperty("outline");
                field.style.removeProperty("outline-offset");
            });

            fields.forEach((field, index) => {

                if (field.disabled) return;

                // Radio button groups
                if (field.type === "radio") {

                    if (processedRadios.has(field)) return;

                    const group = fields.filter(item =>
                        item.type === "radio" &&
                        item.name === field.name &&
                        item.form === field.form &&
                        !item.disabled
                    );

                    group.forEach(item => processedRadios.add(item));

                    const selected = group.find(item => item.checked);

                    const legend = field.closest("fieldset")
                        ?.querySelector("legend")?.innerText.trim();

                    const name = (
                        legend ||
                        getFieldName(field, index) ||
                        "Radio selection"
                    ).replace(/:+\s*$/, "");

                    backendFields.push({
                        name: name,
                        type: "radio",
                        value: selected ? selected.value : "",
                        required: group.some(item => isRequiredField(item)),
                        checked: Boolean(selected),
                        valid: group.every(item => item.validity.valid)
                    });

                    targets.push(group);
                    return;
                }

                // Checkboxes
                if (field.type === "checkbox") {

                    const name = getFieldName(field, index);

                    backendFields.push({
                        name: name,
                        type: "checkbox",
                        value: field.checked ? field.value : "",
                        required: isRequiredField(field),
                        checked: field.checked,
                        valid: field.validity.valid
                    });

                    targets.push([field]);
                    return;
                }

                // Detect field type using its question name
                const name = getFieldName(field, index);
                const lowerName = name.toLowerCase();

                let detectedType = field.type || field.tagName.toLowerCase();

                // Email detection
                if (/email|e-mail/.test(lowerName)) {
                    detectedType = "email";
                }

                // Phone number detection
                else if (/phone|mobile|contact number|telephone/.test(lowerName)) {
                    detectedType = "tel";
                }

                // Normal text, email, phone, date, select and textarea fields
                backendFields.push({
                    name: name,
                    type: detectedType,
                    value: field.value.trim(),
                    required: isRequiredField(field),
                    checked: false,
                    valid: field.validity.valid
                });

                targets.push([field]);
            });

            window.formCheckTargets = targets;

            sendResponse({
                fields: backendFields
            });
        }

        // Apply validation results returned by Flask
        if (request.action === "APPLY_RESULTS") {

            const results = request.results || [];

            results.forEach((item, index) => {

                const targetGroup = window.formCheckTargets[index] || [];

                targetGroup.forEach(field => {

                    field.style.removeProperty("outline");
                    field.style.removeProperty("outline-offset");

                    if (item.status === "invalid") {
                        field.style.outline = "2px solid #dc4545";
                        field.style.outlineOffset = "2px";
                    }
                });
            });

            sendResponse({ success: true });
        }

        return true;
    });
}
