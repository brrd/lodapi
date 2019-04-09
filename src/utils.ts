import * as cheerio from "cheerio";

export function parseForm(body: any) {
  // Get form values
  const $ = cheerio.load(body);
  const form: { [key: string]: string } = {};

  $("[name]").each(function (this: Cheerio) {
    const type = $(this).attr("type");
    if (["button", "submit"].includes(type)) return;
    const name = $(this).attr("name");
    let value = $(this).val();
    if (value == null && type === "checkbox") {
      value = $(this).attr("checked");
    }
    if (value == null) return;

    // Handle Lodel <select> specific controls for indexes selection
    if (name.match(/^pool_candidats_/) != null) {
      const $prev = $(this).prev("input");
      if ($prev.length === 0) {
        return new Error(`Can't get ${name} value`);
      }
      const prevName = $prev.attr("name");
      value = Array.isArray(value) ? value.join(",") : value;
      form[prevName] = value;
    } else {
      form[name] = value;
    }
  });

  if (Object.keys(form).length === 0) {
    throw Error(`Could not get values from form`);
  }
  return form;
};
