/** Client-safe mapping shape + built-in templates (synthetic Malaysian formats). */

export interface ImportMappingInput {
  headerRows: number;
  dateFormat: "auto" | "yyyy-mm-dd" | "dd/mm/yyyy" | "mm/dd/yyyy" | "dd mmm yyyy";
  dateColumn: number;
  descriptionColumn: number;
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
}

export const BUILTIN_PROFILE_TEMPLATES: Array<{
  key: string;
  name: string;
  mapping: ImportMappingInput;
}> = [
  {
    key: "maybank",
    name: "Maybank2u-style (Date, Description, Amount)",
    mapping: {
      headerRows: 1,
      dateFormat: "dd/mm/yyyy",
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
    },
  },
  {
    key: "tng",
    name: "TnG eWallet-style (Date, …, Description, Amount RM)",
    mapping: {
      headerRows: 1,
      dateFormat: "dd/mm/yyyy",
      dateColumn: 0,
      descriptionColumn: 3,
      amountColumn: 4,
    },
  },
  {
    key: "debitcredit",
    name: "Generic debit/credit columns",
    mapping: {
      headerRows: 1,
      dateFormat: "auto",
      dateColumn: 0,
      descriptionColumn: 1,
      debitColumn: 2,
      creditColumn: 3,
    },
  },
];
