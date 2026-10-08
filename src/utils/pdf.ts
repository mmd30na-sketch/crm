/**
 * Canvas drawing helpers for the printed registration forms (A4 at 150 dpi: 1240 x 1754 px).
 * The official contract / tuition receipt page is drawn here; the receipt and cardex pages are
 * drawn inline in StudentRegistrationForm.
 */

export interface ContractPageData {
  today: string;
  courseNumber?: number | string | null;
  enrollmentId?: number | string | null;
  studentName: string;
  nationalCode: string;
  courseTitle: string;
  /** Amount received so far, in Toman. */
  paid: number;
}

export const drawContractPage = (ctx: CanvasRenderingContext2D, data: ContractPageData) => {
  const { today, courseNumber, enrollmentId, studentName, nationalCode, courseTitle, paid } = data;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1240, 1754);

  // Outer Border (Image shows double border layout)
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(50, 50, 1140, 1654);
  ctx.lineWidth = 1;
  ctx.strokeRect(55, 55, 1130, 1644);

  // Top Box Constraints
  // Right side: Logo
  ctx.save();
  ctx.translate(1000, 75);
  // Manual Diamond Outline approximation for Logo
  ctx.beginPath();
  ctx.moveTo(70, 0); ctx.lineTo(140, 30); ctx.lineTo(120, 100); ctx.lineTo(70, 140); ctx.lineTo(20, 100); ctx.lineTo(0, 30); ctx.closePath();
  ctx.lineWidth = 2; ctx.strokeStyle = '#000000'; ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = '#000000'; ctx.font = 'bold 16px Tahoma'; 
  ctx.fillText('کارت هوشمند کرمانشاه', 70, 25);
  ctx.beginPath(); ctx.arc(70, 70, 20, 0, Math.PI*2); ctx.stroke(); 
  ctx.restore();

  // Left side: ID Box
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#000000';
  ctx.strokeRect(90, 80, 400, 80);
  
  // Horizontal divider
  ctx.beginPath(); ctx.moveTo(90, 120); ctx.lineTo(490, 120); ctx.stroke();
  
  // Vertical divider
  ctx.beginPath(); ctx.moveTo(350, 80); ctx.lineTo(350, 160); ctx.stroke();
  
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = '18px Tahoma';
  ctx.fillText('تاریخ :', 420, 108);
  ctx.fillText('شماره پرونده :', 420, 148);
  
  ctx.font = 'bold 24px Tahoma';
  ctx.fillText(today, 220, 108);
  ctx.fillText(String(courseNumber || enrollmentId || ''), 220, 148);

  // Main Title
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px Tahoma';
  ctx.fillText('قرارداد و رسید پرداخت شهریه', 620, 280);

  // Main Dashed Container Outline Structure
  // The image shows two sections divided inside a dashed box.
  
  // Dashed style setup
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#666666';
  const boxTop = 350;
  const boxHeight = 700;
  ctx.strokeRect(100, boxTop, 1040, boxHeight);
  
  // Section 1 inside Dashed Box: Student Details
  ctx.textAlign = 'right';
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 22px Tahoma';
  ctx.fillText('مشخصات کارآموز :', 1100, boxTop + 45);

  const valName = studentName;
  const valNid = nationalCode;
  const valCourse = courseTitle;
  const valPaid = `${paid.toLocaleString('fa-IR')} تومان`;

  let sY = boxTop + 100;
  const drawRow = (label: string, value: string) => {
    ctx.font = '20px Tahoma';
    ctx.fillText(label + ' :', 1050, sY);
    ctx.font = 'bold 26px Tahoma';
    ctx.fillText(value, 800, sY);
    sY += 55;
  };
  
  drawRow('نام و نام خانوادگی', valName);
  drawRow('کد ملی', valNid);
  drawRow('دوره', valCourse);
  drawRow('مبلغ پرداختی', valPaid);

  // Divider Line inside Dashed Box
  ctx.beginPath();
  ctx.moveTo(100, sY + 20);
  ctx.lineTo(1140, sY + 20);
  ctx.stroke();

  // Section 2 inside Dashed Box: Terms
  const tY = sY + 70;
  ctx.font = 'bold 20px Tahoma';
  ctx.fillText('شرایط و تعهدات کارآموز:', 1120, tY);
  
  const rules = [
    'شهریه پرداختی (بیعانه یا تسویه) پس از ثبت نام قطعی و شروع کلاس بندی، به هیچ وجه مسترد نمی گردد.',
    'کارآموز متعهد به حضور منظم در کلاس هاست؛ غیبت بیش از حد مجاز طبق آیین نامه، موجب حذف از دوره و عدم معرفی به آزمون',
    'خواهد شد.', // newline wrap representation
    'آموزشگاه هیچگونه مسئولیتی در قبال قبولی یا مردودی کارآموز در آزمون های فنی و حرفه ای ندارد.',
    'هزینه های ثبت نام آزمون، صدور گواهینامه و آزمون های مجدد، جدا از شهریه آموزشی بوده و بر عهده کارآموز است.',
    'تسویه حساب مالی کامل باید قبل از معرفی به آزمون انجام شود، در غیر این صورت کارت ورود به جلسه صادر نخواهد شد.'
  ];

  ctx.font = '18px Tahoma';
  let rY = tY + 60;
  const drawRule = (num: string, text: string, extraIndent = false) => {
    if(!extraIndent) {
        ctx.fillText('.' + num, 1100, rY);
    }
    ctx.fillText(text, extraIndent ? 1070 : 1070, rY);
    rY += 60;
  };

  drawRule('۱', rules[0]);
  drawRule('۲', rules[1]);
  rY -= 20; // smaller gap for word wrap
  drawRule('', rules[2], true);
  
  // Rule 3 bolding
  ctx.font = 'bold 18px Tahoma';
  drawRule('۳', rules[3]);
  
  // Rule 4 and 5
  ctx.font = '18px Tahoma';
  drawRule('۴', rules[4]);
  drawRule('۵', rules[5]);

  // Signatures at Bottom
  // Dashed style for signature boxes as shown in the picture
  const footY = 1150;
  ctx.font = '20px Tahoma';
  ctx.textAlign = 'center';
  ctx.fillText('مهر آموزشگاه', 300, footY);
  ctx.fillText('امضا و اثرانگشت کارآموز (با قبول شرایط فوق)', 900, footY);

  const boxW = 250;
  const boxH = 160;
  ctx.strokeRect(175, footY + 40, boxW, boxH);
  ctx.strokeRect(775, footY + 40, boxW, boxH);

  ctx.setLineDash([]); // Reset dash for regular texts
  ctx.font = '14px Tahoma';
  ctx.textAlign = 'right';
  ctx.fillText('تاریخ:', 1000, footY + boxH + 20);

  ctx.restore();
};


