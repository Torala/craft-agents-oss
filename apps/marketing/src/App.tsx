export default function App() {
  return (
    <main className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center min-h-screen px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          Craft Agent
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-600 max-w-2xl">
          Connect your data sources and let AI help you work across them.
          Bring together your documents, code, and tools in one powerful interface.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <a
            href="https://agents.craft.do/install-app.sh"
            className="rounded-md bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
          >
            Download for macOS
          </a>
          <a
            href="#features"
            className="text-sm font-semibold leading-6 text-gray-900"
          >
            Learn more <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-24 px-6 bg-gray-50">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 text-center">
            Features
          </h2>
          <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <article className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Connect Sources</h3>
              <p className="mt-2 text-gray-600">
                MCP servers, REST APIs, local filesystems. Integrate Linear, GitHub, Notion, and more.
              </p>
            </article>
            <article className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">AI-Powered</h3>
              <p className="mt-2 text-gray-600">
                Powered by Claude. Get intelligent assistance across all your connected data.
              </p>
            </article>
            <article className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900">Desktop App</h3>
              <p className="mt-2 text-gray-600">
                Native macOS experience with multi-session inbox management.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 text-center text-gray-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Craft Agent. All rights reserved.</p>
      </footer>
    </main>
  )
}
