// Minimal type surface for the official sms.ir SDK (smsir-js ships no types).
declare module 'smsir-js' {
  export interface SmsirParameter {
    name: string;
    value: string | number;
  }

  export interface SmsirResult {
    status?: number;
    message?: string;
    data?: any;
    [key: string]: any;
  }

  export class Smsir {
    constructor(apiKey: string, lineNumber: number | string);
    /** Send a predefined-template ("verify") message; template params are name/value pairs. */
    SendVerifyCode(mobile: string, templateId: number, parameters: SmsirParameter[]): Promise<SmsirResult>;
    SendBulk(messageText: string, mobiles: string[], sendDateTime?: number | null, lineNumber?: number | null): Promise<SmsirResult>;
    SendLikeToLike(messageTexts: string[], mobiles: string[], sendDateTime?: number | null, lineNumber?: number | null): Promise<SmsirResult>;
    getCredit(): Promise<SmsirResult>;
    getLineNumbers(): Promise<SmsirResult>;
  }
}
