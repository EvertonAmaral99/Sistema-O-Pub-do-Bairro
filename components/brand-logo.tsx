import Image from "next/image";

export function BrandLogo({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/logo-pub-do-bairro.png"
      alt="O Pub do Bairro"
      width={150}
      height={150}
      className={`brand-logo ${className}`.trim()}
      priority={priority}
      unoptimized
    />
  );
}
