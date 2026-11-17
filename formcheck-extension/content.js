
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
                        field.name ||
                        field.getAttribute("aria-label") ||
                        "Radio selection"
                    ).replace(/:+\s*$/, "");

                    backendFields.push({
                        name: name,
                        type: "radio",
                        value: selected ? selected.value : "",
                        required: group.some(item => item.required),
                        checked: Boolean(selected),
                        valid: group.every(item => item.validity.valid)
                    });

                    targets.push(group);
                    return;
                }

                // Checkboxes
                if (field.type === "checkbox") {

                    const name = (
                        field.labels?.[0]?.innerText?.trim() ||
                        field.getAttribute("aria-label") ||
                        field.name ||
                        `Checkbox ${index + 1}`
                    ).replace(/:+\s*$/, "");

                    backendFields.push({
                        name: name,
                        type: "checkbox",
                        value: field.checked ? field.value : "",
                        required: field.required,
                        checked: field.checked,
                        valid: field.validity.valid
                    });

                    targets.push([field]);
                    return;
                }

                // Text, email, phone, date, select and textarea fields
                const previousLabel =
                    field.previousElementSibling?.tagName === "LABEL"
                        ? field.previousElementSibling.innerText.trim()
                        : "";

                const name = (
                    field.labels?.[0]?.innerText?.trim() ||
                    previousLabel ||
                    field.getAttribute("aria-label") ||
                    field.name ||
                    field.placeholder ||
                    `Field ${index + 1}`
                ).replace(/:+\s*$/, "");

                backendFields.push({
                    name: name,
                    type: field.type || field.tagName.toLowerCase(),
                    value: field.value.trim(),
                    required: field.required,
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
