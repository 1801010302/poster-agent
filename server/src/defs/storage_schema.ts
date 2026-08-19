import type { BucketDef } from "@sdk/server-types";

export const posterAssets: BucketDef<"poster-assets"> = {
  bucket_name: "poster-assets",
  description: "Private user reference images and persisted generated posters",
};
