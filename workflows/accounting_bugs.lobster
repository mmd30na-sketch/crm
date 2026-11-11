{
  "api": "1",
  "name": "Accounting finance bugfix",
  "goal": "Fix Carla CRM accounting/finance bugs without changing auth, settings, or registration.",
  "repo": "/home/mmd30na/Hydra/openclaw/native/state/workspaces/hephaestus/projects/crm",
  "constraints": [
    "Do not git commit or push",
    "Do not kill or restart the CRM server process",
    "Do not touch Settings.tsx, LoginScreen.tsx, StudentRegistrationForm.tsx, App.tsx unless required",
    "Do not invent fake MySQL/Chabokan sync",
    "Keep RTL Persian desktop UI",
    "No new dummy ledger rows"
  ],
  "bugs": [
    {
      "id": "ACC-01",
      "file": "src/components/AccountingDashboard.tsx",
      "severity": "high",
      "issue": "Ledger expenses ignore date filter. ledgerItems maps `expenses` instead of `filteredExpenses` while payments use filteredPayments."
    },
    {
      "id": "ACC-02",
      "file": "src/components/AccountingDashboard.tsx",
      "severity": "high",
      "issue": "Custom date mode has no inputs. dateFilterMode==='custom' uses customStartDate/customEndDate but the toolbar never renders those fields."
    },
    {
      "id": "ACC-03",
      "file": "src/components/AccountingDashboard.tsx",
      "severity": "medium",
      "issue": "Empty-date filter mismatch: payments with blank date are included; expenses with blank date are excluded."
    },
    {
      "id": "ACC-04",
      "file": "src/components/AccountingDashboard.tsx",
      "severity": "medium",
      "issue": "Hardcoded fake dates '۱۴۰۵/۰۵/۲۸' when pay_date_jalali is missing. Chart badge says پنج ماه اخیر but data is all months with values. Typo تصل تفکیکی."
    },
    {
      "id": "ACC-05",
      "file": "src/components/AccountingDashboard.tsx",
      "severity": "medium",
      "issue": "expenseDesc is sent to API but no description field in the expense modal. Expense errors use alert()."
    },
    {
      "id": "ACC-06",
      "file": "src/components/AccountingDashboard.tsx",
      "severity": "medium",
      "issue": "Course comparison chart uses unfiltered `payments` while income KPIs/area chart use filteredPayments."
    },
    {
      "id": "ACC-07",
      "file": "src/api/client.ts",
      "severity": "high",
      "issue": "createPayment and createExpense ignore server JSON and return id: Date.now()."
    },
    {
      "id": "ACC-08",
      "file": "src/components/StudentsList.tsx",
      "severity": "high",
      "issue": "Live handleSavePayment omits enrollment_id so course collection bars undercount."
    },
    {
      "id": "ACC-09",
      "file": "server.ts",
      "severity": "medium",
      "issue": "JSON expense insert stores category only as pay_method; category field is dropped. Date via toLocaleDateString('fa-IR') is unpadded and breaks YYYY/MM/DD string filters."
    }
  ],
  "lanes": [
    {
      "id": "ui",
      "owner": "flash-ui",
      "files": ["src/components/AccountingDashboard.tsx"],
      "bugs": ["ACC-01", "ACC-02", "ACC-03", "ACC-04", "ACC-05", "ACC-06"]
    },
    {
      "id": "api",
      "owner": "flash-api",
      "files": ["src/api/client.ts", "src/components/StudentsList.tsx", "server.ts"],
      "bugs": ["ACC-07", "ACC-08", "ACC-09"]
    }
  ]
}
