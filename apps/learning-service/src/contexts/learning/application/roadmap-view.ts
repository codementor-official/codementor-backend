import type { Roadmap } from '../domain/model/roadmap';
import type { RoadmapCourseItem } from '../domain/port/roadmap.repository';

export interface RoadmapView {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  field: string;
  level: string;
  coverImageUrl: string | null;
  estimatedHours: number | null;
  progressionMode: string;
  prerequisiteNote: string | null;
  status: string;
  createdBy: string | null;
  rejectionReason: string | null;
  removalRequested: boolean;
  publishedAt: string | null;
  updatedAt: string;
  courses?: RoadmapCourseItem[];
}

export function toRoadmapView(roadmap: Roadmap, courses?: RoadmapCourseItem[]): RoadmapView {
  return {
    id: roadmap.id,
    slug: roadmap.slug,
    title: roadmap.title,
    shortDescription: roadmap.shortDescription,
    description: roadmap.description,
    field: roadmap.field,
    level: roadmap.level,
    coverImageUrl: roadmap.coverImageUrl,
    estimatedHours: roadmap.estimatedHours,
    progressionMode: roadmap.progressionMode,
    prerequisiteNote: roadmap.prerequisiteNote,
    status: roadmap.status,
    createdBy: roadmap.createdBy,
    rejectionReason: roadmap.rejectionReason,
    removalRequested: roadmap.removalRequested,
    publishedAt: roadmap.publishedAt?.toISOString() ?? null,
    updatedAt: roadmap.updatedAt.toISOString(),
    ...(courses !== undefined ? { courses } : {}),
  };
}
