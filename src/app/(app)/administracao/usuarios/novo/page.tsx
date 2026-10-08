import { exigirPerfil } from "@/lib/auth";
import { TituloPagina } from "@/components/EstadoVazio";
import { FormUsuario } from "./FormUsuario";
import { nomesDaPlanilhaSemDono } from "@/lib/atribuicoes";

export default async function PaginaNovoUsuario() {
  await exigirPerfil(["ADMIN"]);
  const nomesDaPlanilha = await nomesDaPlanilhaSemDono();

  return (
    <div>
      <TituloPagina
        titulo="Novo usuário"
        descricao="A conta é criada já confirmada. Com o papel Vendedor, o cadastro correspondente é criado junto e os clientes dele já são atribuídos."
      />
      <FormUsuario nomesDaPlanilha={nomesDaPlanilha} />
    </div>
  );
}
