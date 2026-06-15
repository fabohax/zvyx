import VideoPageContent from "@/components/video-page-content";


type VideoPageProps = {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SavedVideoPage({ params, searchParams }: VideoPageProps) {
  const { videoId } = await params;
  const resolvedSearchParams = await searchParams;

  return <VideoPageContent videoId={videoId} searchParams={resolvedSearchParams} />;
}
