import React from 'react';

export interface ContractPrintFormProps {
  organizationName?: string;
  contractDate?: string;
  caseNumber?: string;
  studentName?: string;
  nationalId?: string;
  courseTitle?: string;
  paymentAmount?: string;
  rules?: Array<{
    id: number;
    prefix: string;
    text: string;
    highlight?: string;
    isEntirelyBold?: boolean;
  }>;
  onPrint?: () => void;
}

const DEFAULT_RULES = [
  {
    id: 1,
    prefix: '۱.',
    text: 'شهریه پرداختی (بیعانه یا تسویه) پس از ثبتنام قطعی و شروع کلاسبندی، به هیچ وجه مسترد نمیگردد.',
    highlight: 'مسترد نمیگردد.',
    isEntirelyBold: false,
  },
  {
    id: 2,
    prefix: '۲.',
    text: 'کارآموز متعهد به حضور منظم در کلاسهاست؛ غیبت بیش از حد مجاز طبق آییننامه، موجب حذف از دوره و عدم معرفی به آزمون خواهد شد.',
    isEntirelyBold: false,
  },
  {
    id: 3,
    prefix: '۳.',
    text: 'آموزشگاه هیچگونه مسئولیتی در قبال قبولی یا مردودی کارآموز در آزمونهای فنی و حرفهای ندارد.',
    isEntirelyBold: true,
  },
  {
    id: 4,
    prefix: '۴.',
    text: 'هزینههای ثبتنام آزمون، صدور گواهینامه و آزمونهای مجدد، جدا از شهریه آموزشی بوده و بر عهده کارآموز است.',
    isEntirelyBold: false,
  },
  {
    id: 5,
    prefix: '۵.',
    text: 'تسویه حساب مالی کامل باید قبل از معرفی به آزمون انجام شود، در غیر این صورت کارت ورود به جلسه صادر نخواهد شد.',
    isEntirelyBold: false,
  },
];

export const ContractPrintForm: React.FC<ContractPrintFormProps> = ({
  organizationName = 'کارت هوشمند کرمانشاه',
  contractDate = new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' }),
  caseNumber = '………',
  studentName = '………………',
  nationalId = '………………',
  courseTitle = '………………',
  paymentAmount = '………………',
  rules = DEFAULT_RULES,
  onPrint,
}) => {
  const handlePrint = () => {
    if (onPrint) {
      onPrint();
    } else if (typeof window !== 'undefined') {
      window.print();
    }
  };

  return (
    <div className="w-full flex flex-col items-center py-6 bg-slate-100 min-h-screen print:bg-white print:p-0">
      {/* Top Action Bar (hidden on print) */}
      <div className="w-full max-w-[210mm] flex justify-end mb-4 px-2 print:hidden">
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow transition-colors cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
            />
          </svg>
          چاپ قرارداد (A4)
        </button>
      </div>

      {/* A4 Container */}
      <div
        dir="rtl"
        className="w-full max-w-[210mm] min-h-[297mm] bg-white text-slate-900 border border-slate-300 shadow-xl rounded-sm p-10 sm:p-14 flex flex-col justify-between print:border-none print:shadow-none print:p-8 print:w-[210mm] print:h-[297mm] print:max-w-none print:m-0"
        style={{ fontFamily: 'Tahoma, system-ui, -apple-system, sans-serif' }}
      >
        <div>
          {/* Header Area */}
          <header className="flex items-start justify-between pb-6 border-b border-slate-200">
            {/* Right: Logo & Organization Brand */}
            <div className="flex items-center gap-3">
              <div className="relative w-16 h-16 flex items-center justify-center border-2 border-slate-800 rounded-xl bg-slate-50 p-2 shadow-sm">
                <svg
                  className="w-10 h-10 text-slate-800"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                  <path d="M12 11a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                  <path d="M7 17.5c0-2 3-3 5-3s5 1 5 3" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold tracking-tight text-slate-900">
                  {organizationName}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  سامانه مدیریت و ثبتنام کارآموزان
                </span>
              </div>
            </div>

            {/* Left: Metadata (Date & Case Number) */}
            <div className="flex flex-col items-start gap-1 text-sm bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">تاریخ :</span>
                <span className="font-semibold text-slate-800">{contractDate}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">شماره پرونده :</span>
                <span className="font-semibold text-slate-800 tracking-wider">{caseNumber}</span>
              </div>
            </div>
          </header>

          {/* Main Title */}
          <div className="text-center my-8">
            <h1 className="text-2xl font-bold text-slate-900 inline-block pb-2 border-b-2 border-slate-800 px-6">
              قرارداد و رسید پرداخت شهریه
            </h1>
          </div>

          {/* Section 1: مشخصات کارآموز */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-900 inline-block" />
              <h2 className="text-lg font-bold text-slate-900">مشخصات کارآموز :</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50/70 p-5 rounded-xl border border-slate-200 text-sm leading-relaxed">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium min-w-[120px]">نام و نام خانوادگی :</span>
                <span className="font-bold text-slate-900">{studentName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium min-w-[120px]">کد ملی :</span>
                <span className="font-semibold text-slate-900 tracking-wider">{nationalId}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium min-w-[120px]">دوره :</span>
                <span className="font-bold text-slate-900">{courseTitle}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium min-w-[120px]">مبلغ پرداختی :</span>
                <span className="font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                  {paymentAmount}
                </span>
              </div>
            </div>
          </section>

          {/* Section 2: شرایط و تعهدات کارآموز */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-900 inline-block" />
              <h2 className="text-lg font-bold text-slate-900">شرایط و تعهدات کارآموز:</h2>
            </div>
            <div className="space-y-3.5 pr-1">
              {rules.map((rule) => {
                if (rule.isEntirelyBold) {
                  return (
                    <div
                      key={rule.id}
                      className="flex items-start gap-2.5 text-sm leading-7 text-slate-950 font-bold bg-amber-50/60 p-2.5 rounded-lg border-r-4 border-amber-600"
                    >
                      <span className="shrink-0 font-bold">{rule.prefix}</span>
                      <p>{rule.text}</p>
                    </div>
                  );
                }

                if (rule.highlight && rule.text.includes(rule.highlight)) {
                  const parts = rule.text.split(rule.highlight);
                  return (
                    <div key={rule.id} className="flex items-start gap-2.5 text-sm leading-7 text-slate-800">
                      <span className="shrink-0 font-bold text-slate-900">{rule.prefix}</span>
                      <p>
                        {parts[0]}
                        <span className="font-bold text-red-700 underline decoration-red-400 decoration-1 underline-offset-4">
                          {rule.highlight}
                        </span>
                        {parts[1]}
                      </p>
                    </div>
                  );
                }

                return (
                  <div key={rule.id} className="flex items-start gap-2.5 text-sm leading-7 text-slate-800">
                    <span className="shrink-0 font-bold text-slate-900">{rule.prefix}</span>
                    <p>{rule.text}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Bottom Area: Divider & Signatures */}
        <div className="mt-8 pt-6">
          <div className="w-full border-t-2 border-dashed border-slate-300 mb-8" />

          <div className="grid grid-cols-2 gap-8 items-end px-4">
            {/* Student Signature */}
            <div className="flex flex-col items-start gap-4">
              <div className="text-sm font-bold text-slate-900">
                امضا و اثرانگشت کارآموز (با قبول شرایط فوق)
              </div>
              <div className="w-full h-28 border border-dashed border-slate-300 rounded-lg flex flex-col justify-between p-3 bg-slate-50/40">
                <span className="text-xs text-slate-400">[محل امضا و اثرانگشت]</span>
                <span className="text-xs text-slate-500 self-end">تاریخ: ..............................</span>
              </div>
            </div>

            {/* Institute Stamp */}
            <div className="flex flex-col items-center gap-4">
              <div className="text-sm font-bold text-slate-900">مهر و امضای آموزشگاه</div>
              <div className="w-full h-28 border border-dashed border-slate-300 rounded-lg flex items-center justify-center p-3 bg-slate-50/40">
                <span className="text-xs text-slate-400">[محل مهر آموزشگاه]</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default ContractPrintForm;
