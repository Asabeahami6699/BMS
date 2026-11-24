import { defaultRegistrationFormSetup, type RegistrationFormSetup } from "@bms/shared";
import { downloadHtmlDocument, printHtmlDocument } from "./printHtml";
import {
  buildRegistrationFormDocumentHtml,
  buildSimplifiedKycRegistrationFormDocumentHtml
} from "./registrationFormDocument";

export type RegistrationFormPrintContext = {
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  companyLogoUrl?: string;
};

function documentHtml(setup: RegistrationFormSetup, context: RegistrationFormPrintContext, isDefault: boolean): string {
  return buildRegistrationFormDocumentHtml({
    setup,
    companyName: context.companyName,
    companyPhone: context.companyPhone,
    companyAddress: context.companyAddress,
    companyLogoUrl: context.companyLogoUrl,
    isDefault
  });
}

export function printRegistrationForm(setup: RegistrationFormSetup, context: RegistrationFormPrintContext = {}): void {
  printHtmlDocument(documentHtml(setup, context, false), "Pop-up blocked. Allow pop-ups to print the registration form.");
}

export function downloadRegistrationForm(
  setup: RegistrationFormSetup,
  context: RegistrationFormPrintContext = {}
): void {
  downloadHtmlDocument(documentHtml(setup, context, false), "customer-registration-form.html");
}

export function printDefaultRegistrationForm(context: RegistrationFormPrintContext = {}): void {
  printHtmlDocument(
    documentHtml(defaultRegistrationFormSetup(), context, true),
    "Pop-up blocked. Allow pop-ups to print the registration form."
  );
}

export function downloadDefaultRegistrationForm(context: RegistrationFormPrintContext = {}): void {
  downloadHtmlDocument(
    documentHtml(defaultRegistrationFormSetup(), context, true),
    "customer-registration-form-default.html"
  );
}

function simplifiedKycDocumentHtml(
  setup: RegistrationFormSetup,
  context: RegistrationFormPrintContext
): string {
  return buildSimplifiedKycRegistrationFormDocumentHtml({
    setup,
    companyName: context.companyName,
    companyPhone: context.companyPhone,
    companyAddress: context.companyAddress,
    companyLogoUrl: context.companyLogoUrl
  });
}

export function printSimplifiedKycRegistrationForm(
  setup: RegistrationFormSetup,
  context: RegistrationFormPrintContext = {}
): void {
  printHtmlDocument(
    simplifiedKycDocumentHtml(setup, context),
    "Pop-up blocked. Allow pop-ups to print the Simplified KYC registration form."
  );
}

export function downloadSimplifiedKycRegistrationForm(
  setup: RegistrationFormSetup,
  context: RegistrationFormPrintContext = {}
): void {
  downloadHtmlDocument(
    simplifiedKycDocumentHtml(setup, context),
    "simplified-kyc-registration-form.html"
  );
}
