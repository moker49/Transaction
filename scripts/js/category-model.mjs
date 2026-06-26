export function selectedCategory(categories, categoryId) {
  const id = Number(categoryId);
  return Number.isInteger(id) && id > 0
    ? categories.find((category) => category.id === id) || null
    : null;
}

export function rootCategoryId(categories, categoryId) {
  let category = categories.find((candidate) => candidate.id === Number(categoryId));
  while (category?.parent_id) {
    const parent = categories.find((candidate) => candidate.id === category.parent_id);
    if (!parent) {
      break;
    }
    category = parent;
  }
  return category?.id || null;
}

export function effectiveCategoryColor(categories, category) {
  if (category.color) {
    return category.color;
  }
  const parent = categories.find((candidate) => candidate.id === category.parent_id);
  return parent?.color;
}

export function orderedCategories(categories) {
  return categories.slice().sort((a, b) => categorySortKey(categories, a).localeCompare(categorySortKey(categories, b)));
}

export function categorySortKey(categories, category) {
  const parent = categories.find((candidate) => candidate.id === category.parent_id);
  const parentName = parent?.name || category.name;
  const parentRank = Number.isFinite(Number(parent?.sort_order ?? category.sort_order))
    ? Number(parent?.sort_order ?? category.sort_order)
    : 999999;
  const categoryRank = category.parent_id === null
    ? -1
    : Number.isFinite(Number(category.sort_order))
      ? Number(category.sort_order)
      : 999999;
  return `${String(parentRank).padStart(6, "0")}:${parentName}:${String(categoryRank).padStart(6, "0")}:${category.name}`;
}

export function categoryLabel(categories, category) {
  const parent = categories.find((candidate) => candidate.id === category.parent_id);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

export function categoryDescendantIds(categories, categoryId) {
  const descendants = new Set();
  const visit = (parentId) => {
    categories
      .filter((category) => category.parent_id === parentId)
      .forEach((category) => {
        descendants.add(category.id);
        visit(category.id);
      });
  };
  visit(categoryId);
  return descendants;
}

export function categoryOptions(categories) {
  return orderedCategories(categories).map((category) => ({ value: String(category.id), label: categoryLabel(categories, category) }));
}

export function categoryLabelById(categories, categoryId) {
  const category = categories.find((candidate) => candidate.id === categoryId);
  return category ? categoryLabel(categories, category) : "";
}
