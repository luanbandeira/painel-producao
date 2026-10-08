import { describe, expect, it } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  AuthUnknownError,
} from "@supabase/supabase-js";
import {
  classificarErroLogin,
  ehFalhaDeConsulta,
  ehInstabilidadeDeSessao,
} from "./instabilidade";

describe("classificarErroLogin", () => {
  it("senha errada conta como falha de credencial", () => {
    const erro = new AuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(classificarErroLogin(erro)).toBe("credencial");
  });

  it("502 e 504 do Supabase são instabilidade, não senha errada", () => {
    expect(classificarErroLogin(new AuthRetryableFetchError("Bad Gateway", 502))).toBe(
      "instabilidade"
    );
    expect(
      classificarErroLogin(new AuthRetryableFetchError("Gateway Timeout", 504))
    ).toBe("instabilidade");
  });

  it("falha de rede sem resposta é instabilidade", () => {
    expect(classificarErroLogin(new AuthRetryableFetchError("fetch failed", 0))).toBe(
      "instabilidade"
    );
  });

  it("resposta ilegível do gateway é instabilidade", () => {
    const erro = new AuthUnknownError("Unexpected token <", null);
    expect(classificarErroLogin(erro)).toBe("instabilidade");
  });

  it("exceção comum é instabilidade", () => {
    expect(classificarErroLogin(new Error("boom"))).toBe("instabilidade");
  });

  it("limite do próprio Supabase não é senha errada", () => {
    const erro = new AuthApiError("Too many requests", 429, "over_request_rate_limit");
    expect(classificarErroLogin(erro)).toBe("limite");
  });

  it("resposta sem erro e sem usuário conta como credencial", () => {
    expect(classificarErroLogin(null)).toBe("credencial");
  });
});

describe("ehInstabilidadeDeSessao", () => {
  it("sessão ausente é só alguém deslogado", () => {
    expect(ehInstabilidadeDeSessao(new AuthSessionMissingError())).toBe(false);
  });

  it("JWT rejeitado é sessão inválida, não instabilidade", () => {
    expect(ehInstabilidadeDeSessao(new AuthApiError("bad jwt", 403, "bad_jwt"))).toBe(
      false
    );
  });

  it("502 e 429 impedem saber quem é o usuário", () => {
    expect(ehInstabilidadeDeSessao(new AuthRetryableFetchError("Bad Gateway", 502))).toBe(
      true
    );
    expect(
      ehInstabilidadeDeSessao(new AuthApiError("Too many requests", 429, undefined))
    ).toBe(true);
  });

  it("sem erro não há instabilidade", () => {
    expect(ehInstabilidadeDeSessao(null)).toBe(false);
  });
});

describe("ehFalhaDeConsulta", () => {
  it("sem erro não é falha", () => {
    expect(ehFalhaDeConsulta(null)).toBe(false);
  });

  it("linha inexistente (PGRST116) é resultado, não falha", () => {
    expect(ehFalhaDeConsulta({ code: "PGRST116" })).toBe(false);
  });

  it("qualquer outro erro é falha", () => {
    expect(ehFalhaDeConsulta({ code: "" })).toBe(true);
    expect(ehFalhaDeConsulta({})).toBe(true);
    expect(ehFalhaDeConsulta({ code: "57014" })).toBe(true);
  });
});
