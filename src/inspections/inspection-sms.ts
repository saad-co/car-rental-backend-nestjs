import { DriverLanguage } from "../drivers/driver.entity.js";
import { InspectionType } from "./inspection.entity.js";

/**
 * The texts that carry the link (the client's translation file `module3-inspection-i18n_v1.2.json`, block `sms`, kept word for
 * word, except the link time: 72 hours instead of 24 since D112). The page itself reads the whole file in the frontend; the backend only needs these two, in both languages.
 * The check-out text says "today is your return day" because the client's flow sent it on the morning of the return; sending
 * is manual here (D102), so staff send it on that day (B140).
 */
const LINK_TEXTS: Record<DriverLanguage, Record<InspectionType, string>> = {
  [DriverLanguage.en]: {
    [InspectionType.checkIn]:
      "GonzoCar: Hi {first_name}, before you drive the {vehicle} ({plate}), please complete your vehicle check-in photos here: {link} It takes about 5 minutes. Link expires in 72 hours.",
    [InspectionType.checkOut]:
      "GonzoCar: Hi {first_name}, today is your return day for the {vehicle} ({plate}). Before you leave the car and keys, please complete your check-out photos here: {link} It takes about 5 minutes.",
  },
  [DriverLanguage.es]: {
    [InspectionType.checkIn]:
      "GonzoCar: Hola {first_name}, antes de manejar el {vehicle} ({plate}), por favor complete las fotos de entrega del vehículo aquí: {link} Toma unos 5 minutos. El enlace vence en 72 horas.",
    [InspectionType.checkOut]:
      "GonzoCar: Hola {first_name}, hoy es su día de devolución del {vehicle} ({plate}). Antes de dejar el auto y las llaves, por favor complete sus fotos de devolución aquí: {link} Toma unos 5 minutos.",
  },
};

/**
 * The text that carries the link, in the driver's language. A vehicle with no plate on file loses its " ({plate})" part
 * instead of showing an empty pair of brackets.
 */
export function inspectionLinkText(input: {
  type: InspectionType;
  language: DriverLanguage;
  firstName: string;
  vehicle: string;
  plate: string | null;
  link: string;
}): string {
  let text = LINK_TEXTS[input.language][input.type];
  if (!input.plate) text = text.replace(" ({plate})", "");
  return text
    .replace("{first_name}", () => input.firstName)
    .replace("{vehicle}", () => input.vehicle)
    .replace("{plate}", () => input.plate ?? "")
    .replace("{link}", () => input.link);
}
