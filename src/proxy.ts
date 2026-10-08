import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Renova a sessão do Supabase a cada requisição, protege as rotas (quem não
 * está autenticado vai para /login) e emite a Content-Security-Policy.
 * (No Next 16, proxy.ts substitui o antigo middleware.ts.)
 *
 * A CSP fica aqui, e não em next.config.ts, porque cada resposta precisa de
 * um nonce novo: só assim `script-src` dispensa 'unsafe-inline' e um script
 * injetado deixa de rodar. O Next lê o nonce do cabeçalho da requisição e o
 * aplica sozinho nas próprias tags. Isso exige renderização dinâmica — que
 * este sistema já usa em toda página, por depender de sessão.
 *
 * `style-src` mantém 'unsafe-inline' de propósito: as barras de progresso
 * usam atributo `style`, que nonce não cobre, e injeção de CSS é risco de
 * outra ordem. Note que basta um nonce em `style-src` para o navegador
 * ignorar o 'unsafe-inline' — por isso os dois não convivem ali.
 */
function montarCSP(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // O navegador só fala com a própria aplicação: não há cliente Supabase
    // no lado do cliente
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export default async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = montarCSP(nonce, process.env.NODE_ENV === "development");

  /**
   * Cabeçalhos da requisição com o nonce. Recriado a cada uso porque o
   * cliente do Supabase pode reescrever os cookies no meio do caminho, e a
   * cópia precisa ser posterior a isso.
   */
  const comNonce = () => {
    const h = new Headers(request.headers);
    h.set("x-nonce", nonce);
    h.set("Content-Security-Policy", csp);
    return h;
  };

  let response = NextResponse.next({ request: { headers: comNonce() } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request: { headers: comNonce() } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Importante: não inserir lógica entre a criação do cliente e getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rotaLogin = request.nextUrl.pathname.startsWith("/login");

  if (!user && !rotaLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const redirecionamento = NextResponse.redirect(url);
    redirecionamento.headers.set("Content-Security-Policy", csp);
    return redirecionamento;
  }

  // Quem já está logado vai direto ao painel — exceto o usuário inativo, que
  // `exigirPerfil` manda para cá com o motivo. Devolvê-lo ao painel formava
  // um laço de redirecionamentos.
  const loginPorInatividade =
    request.nextUrl.searchParams.get("motivo") === "inativo";

  if (user && rotaLogin && !loginPorInatividade) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    const redirecionamento = NextResponse.redirect(url);
    redirecionamento.headers.set("Content-Security-Policy", csp);
    return redirecionamento;
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
