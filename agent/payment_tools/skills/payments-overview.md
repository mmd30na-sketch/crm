## payments-overview
- برای هر پرسش درباره تراکنش، درآمد آنلاین، تسویه یا وضعیت پرداخت زرین‌پال از ابزارهای zarinpal_* استفاده کنید و عدد حدس نزنید.
- «تراکنش‌های این ماه/امروز/هفته» → zarinpal_list_transactions با from_date/to_date شمسی (YYYY/MM/DD) و status=ALL؛ جمع موفق‌ها = successful_total_toman.
- وضعیت یک پرداخت با authority → zarinpal_transaction_inquiry. پرداخت‌های جامانده (وریفای‌نشده) → zarinpal_unverified_list.
- واریز به حساب بانکی → zarinpal_reconcile_list. فهرست درگاه‌ها → zarinpal_list_terminals.
- واحد پول: API گزارش (GraphQL) همیشه ریال است و ابزارها به تومان تبدیل می‌کنند؛ درگاه پرداخت طبق تنظیم IRR یا IRT است. همیشه به تومان گزارش دهید.
- اگر sandbox=true بود به مدیر بگویید درگاه در حالت تست است.
- هرگز کد مرچنت، توکن یا شماره کامل کارت را نشان ندهید؛ کارت فقط به شکل ****1234.
