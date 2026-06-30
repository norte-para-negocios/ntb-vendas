import type { Metadata } from 'next';
import { fetchStoreBySlug } from '@/lib/api';
import { ClientModule } from '@/components/modules/ClientModule';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const store = await fetchStoreBySlug(slug);

  if (!store) {
    return { title: 'Cardápio Digital' };
  }

  return {
    title: `${store.name} | Cardápio Digital`,
    description: `Acesse o cardápio de ${store.name} e faça seu pedido.`,
    openGraph: {
      title: store.name,
      description: `Cardápio digital de ${store.name}`,
      images: store.logo_url ? [{ url: store.logo_url }] : [],
    },
  };
}

export default async function ClientPage({ params }: Props) {
  const { slug } = await params;
  return <ClientModule slug={slug} />;
}
