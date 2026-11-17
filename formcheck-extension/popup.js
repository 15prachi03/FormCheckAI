
document.getElementById("checkForm").addEventListener("click", async () => {
    const result = document.getElementById("result");

    result.textContent = "Checking your form...";

    try {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        // Collect fields from the active webpage
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
        });

        const collected = await chrome.tabs.sendMessage(
            tab.id,
            { action: "CHECK_FORM" }
        );

        // Send collected fields to deployed Flask backend
        const apiResponse = await fetch(
            "https://formcheckai-32co.onrender.com/api/validate-online-form",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    fields: collected.fields
                })
            }
        );

        const response = await apiResponse.json();

        if (!apiResponse.ok) {
            throw new Error(response.error || "Backend validation failed.");
        }

        // Highlight invalid fields on the webpage
        await chrome.tabs.sendMessage(tab.id, {
            action: "APPLY_RESULTS",
            results: response.results
        });

        // Display the backend validation report
        result.replaceChildren();

        const summary = document.createElement("div");
        summary.className = "summary";

        summary.textContent =
            `Fields checked: ${response.totalFields} | ` +
            `Issues: ${response.issuesCount} | ` +
            `Valid: ${response.validCount}`;

        result.appendChild(summary);

        response.results.forEach(item => {
            const card = document.createElement("div");
            card.className = `field-card ${item.status}`;

            const name = document.createElement("strong");
            name.textContent = item.name;

            const message = document.createElement("p");
            message.textContent = item.message;

            card.appendChild(name);
            card.appendChild(message);

            result.appendChild(card);
        });

    } catch (error) {
        console.error("FormCheck AI error:", error);

        result.textContent =
            "Unable to connect to FormCheck AI. " +
            "Please check your internet connection and try again.";
    }
});
