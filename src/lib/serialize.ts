import type { UserRow } from "../types/env";

export type IdentificationRow = {
  id: string;
  user_id: string;
  plant_name: string;
  scientific_name: string;
  family: string;
  category: string;
  confidence: number;
  image_key: string;
  image_url: string;
  description: string;
  care_instructions: string;
  curiosities: string;
  identified_at: string;
};

export type CollectionRow = { id: string; user_id: string; name: string; created_at: string };

export type PlantRow = {
  id: string;
  user_id: string;
  collection_id: string;
  identification_id: string;
  plant_name: string;
  scientific_name: string;
  family: string;
  category: string;
  image_url: string;
  description: string;
  care_instructions: string;
  curiosities: string;
  created_at: string;
};

export type SubscriptionRow = { user_id: string; plan: string; started_at: string; renews_at: string | null };

export type ReminderRow = {
  id: string;
  user_id: string;
  plant_id: string;
  interval_days: number;
  hour: number;
  minute: number;
  last_watered_at: string | null;
  created_at: string;
};

export const userJson = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  displayName: u.display_name,
  hasCompletedOnboarding: u.has_completed_onboarding === 1,
  createdAt: u.created_at,
});

export const identificationJson = (r: IdentificationRow) => ({
  id: r.id,
  plantName: r.plant_name,
  scientificName: r.scientific_name,
  family: r.family,
  category: r.category,
  confidence: r.confidence,
  imageUrl: r.image_url,
  description: r.description,
  careInstructions: JSON.parse(r.care_instructions),
  curiosities: JSON.parse(r.curiosities),
  identifiedAt: r.identified_at,
});

export const collectionJson = (r: CollectionRow) => ({ id: r.id, name: r.name, createdAt: r.created_at });

export const plantJson = (r: PlantRow) => ({
  id: r.id,
  collectionId: r.collection_id,
  identificationId: r.identification_id,
  plantName: r.plant_name,
  scientificName: r.scientific_name,
  family: r.family,
  category: r.category,
  imageUrl: r.image_url,
  description: r.description,
  careInstructions: JSON.parse(r.care_instructions),
  curiosities: JSON.parse(r.curiosities),
  createdAt: r.created_at,
});

export const subscriptionJson = (r: SubscriptionRow) => ({
  plan: r.plan,
  startedAt: r.started_at,
  renewsAt: r.renews_at,
});

export const reminderJson = (r: ReminderRow) => ({
  id: r.id,
  plantId: r.plant_id,
  intervalDays: r.interval_days,
  hour: r.hour,
  minute: r.minute,
  lastWateredAt: r.last_watered_at,
  createdAt: r.created_at,
});
