declare module '@google/generative-ai' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: { model: string }): any;
  }
}

declare module 'jspdf' {
  export class jsPDF {
    constructor(options?: any);
    text(text: string, x: number, y: number): void;
    save(filename: string): void;
    addPage(): void;
    setFontSize(size: number): void;
    setFont(font: string): void;
    internal: {
      pageSize: {
        height: number;
        width: number;
      };
    };
  }
}
