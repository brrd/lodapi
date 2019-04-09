import * as cheerio from "cheerio";

export function parseForm(body: any, parentSelector?: string) {
  // Get form values
  const $ = cheerio.load(body);
  const form: { [key: string]: string } = {};

  $(`${parentSelector} [name]`).each(function (this: Cheerio) {
    const type = $(this).attr("type");
    if (["button", "submit"].includes(type)) return;
    const name = $(this).attr("name");
    let value = type === "checkbox" ? $(this).attr("checked") : $(this).val();
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

export function parseIndex(body: any, id: number) {
  const $ = cheerio.load(body);
  const idTypeStr = $("input[name='idtype']").eq(0).attr("value");
  const idType = Number(idTypeStr);
  if (!idType) {
    throw Error(`Error: idType not found on index ${id}`);
  }

  const relatedEntities: number[] = [];
  $(".listEntities li").each(function (this: Cheerio) {
    const href = $(this).find(".action .move + .item a").eq(0).attr("href");
    const match = (href.match(/\d+$/) || [])[0];
    if (match.length > 0) {
      const id = Number(match);
      relatedEntities.push(id);
    } else {
      throw Error(`Error: missing related entity id in index ${id}`);
    }
  });
  return { id, idType, relatedEntities };
}
