export default function Page() {
  return (
    <main className="app-shell">
      <iframe
        src="/app/index.html"
        title="여권사진 준비"
        allow="camera"
      />
    </main>
  );
}
