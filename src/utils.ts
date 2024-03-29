import * as cheerio from "cheerio";

export function parseForm(body: any, parentSelector:string = "") {
  // Get form values
  const $ = cheerio.load(body);
  const form: { [key: string]: string | string[] } = {};

  $(`${parentSelector} [name]`).each(function (this: cheerio.Node) {
    const type = $(this).attr("type");
    if (type && ["button", "submit"].includes(type)) return;
    const name = $(this).attr("name") || "";
    let value = type === "checkbox" ? $(this).attr("checked") : $(this).val();
    if (value == null) return;

    // Handle Lodel <select> specific controls for indexes selection
    if (name.match(/^pool_candidats_/) != null) {
      const $prev = $(this).prev("input");
      if ($prev.length === 0) {
        throw Error(`Can't get ${name} value`);
      }
      const prevName = $prev.attr("name") || "";
      value = Array.isArray(value) ? value.join(",") : value;
      form[prevName] = value;
    } else {
      form[name] = value;
    }
  });
  return form;
};

