import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params:Promise<{id:string}> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null,{status:404});
  const productId = Number((await params).id);
  if (!Number.isInteger(productId) || productId < 1) return new Response(null,{status:404});
  const result = await query<{image_data:Buffer|null;image_mime:string|null}>("SELECT image_data,image_mime FROM products WHERE id=$1",[productId]);
  const image = result.rows[0];
  if (!image?.image_data || !image.image_mime) return new Response(null,{status:404});
  return new Response(new Uint8Array(image.image_data),{
    headers:{"Content-Type":image.image_mime,"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"},
  });
}
