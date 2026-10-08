import { exigirPerfil } from "@/lib/auth";
import { TituloPagina } from "@/components/EstadoVazio";
import { ultimoDiaComDados } from "@/lib/dashboard";
import { FormUpload } from "./FormUpload";

export default async function PaginaNovoUpload() {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const coberturaAtual = await ultimoDiaComDados();

  return (
    <div>
      <TituloPagina
        titulo="Novo upload"
        descricao="Envie a planilha diária. O sistema lê o arquivo, sugere as datas e mostra uma prévia antes de gravar qualquer coisa."
      />
      <FormUpload coberturaAtual={coberturaAtual} />
    </div>
  );
}
