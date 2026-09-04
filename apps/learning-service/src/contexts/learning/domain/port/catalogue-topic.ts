export interface CatalogueTopic {
  id: string;
  slug: string;
  name: string;
  category: string;
}

export interface CatalogueTopicSummary extends CatalogueTopic {
  count: number;
}
