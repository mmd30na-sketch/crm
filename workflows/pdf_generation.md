# PDF Generation Workflow (CRM)

1. **Goal:** Generate a three-page A4 PDF file directly in the browser when a student registers successfully.
   - Page 1: Payment Receipt (`رسید دریافت وجه`)
   - Page 2: Cardex (`تایید ثبت نام و کاردکس`)
   - Page 3: Contract (`قرارداد فی ما بین آموزشگاه و کارآموز`)

2. **Template Source:** The client provided `Contract.pdf`, `IDCard.pdf`, and `Receipt.pdf` as templates.

3. **Current Flaw:**
   - Previous rapid implementations attempted to render all components inside a single sprawling script block without properly evaluating spacing, scaling, and specific table properties. 
   - Multi-agent deployment inside single tasks led to unmanageable code states because agents overwrote `generateAndUploadReceipt` chaotically.

4. **Correct Workflow:**
   - **Step 1:** Prepare `pdf.ts` abstraction. Don't write raw Canvas logic inside `StudentRegistrationForm.tsx`. It clutters the UI component.
   - **Step 2:** Write `drawReceipt(ctx, data)`, `drawCardex(ctx, data)`, and `drawContract(ctx, data)` independently.
   - **Step 3:** Use a single lightweight Flash worker (with payload-only context) simply pointing to the coordinate boundaries of the raw text provided earlier, returning a simple `[x,y]` JSON mapping.
   - **Step 4:** Hephaestus applies the maps iteratively into `pdf.ts`.
   - **Step 5:** Link `pdf.ts` back to `StudentRegistrationForm.tsx`.

