import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { ensureQuantity, formatQuantity, sumQuantities } from '../../utils/quantity.js';

export default function ReportsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const isOperator = user?.role === 'Operador';
  const canViewReports = permissions.includes('reports.read') && !isOperator;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [groupData, setGroupData] = useState([]);
  const [depositData, setDepositData] = useState([]);
  const [groupDetailState, setGroupDetailState] = useState({
    groupKey: null,
    groupName: '',
    items: [],
    total: { boxes: 0, units: 0 }
  });
  const [groupDetailLoading, setGroupDetailLoading] = useState(false);
  const [groupDetailError, setGroupDetailError] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [groupResponse, depositResponse] = await Promise.all([
          api.get('/reports/stock/by-group'),
          api.get('/reports/stock/by-deposit')
        ]);
        if (!active) return;
        setGroupData(Array.isArray(groupResponse) ? groupResponse : []);
        setDepositData(Array.isArray(depositResponse) ? depositResponse : []);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    if (canViewReports) {
      load();
    } else {
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [api, canViewReports]);

  const consolidatedGroups = useMemo(() => {
    return groupData.map(group => {
      const normalizedTotal = ensureQuantity(group.total);
      const hasIdentifier = typeof group.id === 'string' && group.id.length > 0;
      const queryKey = hasIdentifier ? String(group.id) : 'ungrouped';
      return {
        id: hasIdentifier ? String(group.id) : null,
        key: hasIdentifier ? String(group.id) : 'ungrouped',
        queryKey,
        name: group.name || 'Sin grupo',
        total: normalizedTotal
      };
    });
  }, [groupData]);

  const handleViewGroupDetail = async group => {
    const selected = {
      groupKey: group.queryKey,
      groupName: group.name || 'Sin grupo',
      items: [],
      total: ensureQuantity(group.total)
    };
    setGroupDetailState(selected);
    setGroupDetailError(null);
    setGroupDetailLoading(true);
    try {
      const queryParam = encodeURIComponent(group.queryKey);
      const detailResponse = await api.get(`/reports/stock/by-group?includeItems=true&groupId=${queryParam}`);
      const matchKey = group.id ? String(group.id) : 'ungrouped';
      const detailGroup = Array.isArray(detailResponse)
        ? detailResponse.find(entry => (entry.id ? String(entry.id) : 'ungrouped') === matchKey)
        : null;
      setGroupDetailState({
        groupKey: group.queryKey,
        groupName: group.name || 'Sin grupo',
        items: Array.isArray(detailGroup?.items) ? detailGroup.items : [],
        total: ensureQuantity(detailGroup?.total ?? group.total)
      });
    } catch (err) {
      setGroupDetailError(err);
    } finally {
      setGroupDetailLoading(false);
    }
  };

  const handleCloseGroupDetail = () => {
    setGroupDetailState({
      groupKey: null,
      groupName: '',
      items: [],
      total: { boxes: 0, units: 0 }
    });
    setGroupDetailError(null);
    setGroupDetailLoading(false);
  };

  if (!canViewReports) {
    return <ErrorMessage error="No tiene permisos para acceder a esta sección." />;
  }

  if (loading) {
    return <LoadingIndicator message="Generando reporte de stock..." />;
  }

  return (
    <div>
      <h2>Reportes de stock</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Analice el inventario consolidado por grupo y por depósito.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="section-card">
        <h3>Stock consolidado por grupo</h3>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Total</th>
                <th style={{ width: '1%', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {consolidatedGroups.map(group => (
                <tr key={group.key}>
                  <td>{group.name}</td>
                  <td>{formatQuantity(group.total)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => handleViewGroupDetail(group)}
                      disabled={groupDetailLoading && groupDetailState.groupKey === group.queryKey}
                    >
                      Ver detalle
                    </button>
                  </td>
                </tr>
              ))}
              {consolidatedGroups.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay información consolidada por grupo disponible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(groupDetailState.groupKey || groupDetailLoading || groupDetailError) && (
        <div className="section-card">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '0.75rem'
            }}
          >
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>Desglose por producto</h3>
              <p style={{ margin: 0, color: '#475569' }}>
                {groupDetailState.groupName
                  ? `Grupo seleccionado: ${groupDetailState.groupName}`
                  : 'Seleccione un grupo para ver el detalle por producto.'}
              </p>
            </div>
            {groupDetailState.groupKey && (
              <button type="button" onClick={handleCloseGroupDetail}>
                Cerrar
              </button>
            )}
          </div>

          {groupDetailError && <ErrorMessage error={groupDetailError} />}

          {groupDetailLoading && (
            <p style={{ margin: '1rem 0', color: '#475569' }}>Cargando desglose del grupo seleccionado...</p>
          )}

          {!groupDetailLoading && !groupDetailError && groupDetailState.groupKey && (
            <>
              <p style={{ marginBottom: '0.75rem', color: '#1f2937' }}>
                Stock total del grupo: {formatQuantity(groupDetailState.total)}
              </p>
              <div className="table-wrapper" style={{ marginTop: '1rem' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descripción</th>
                      <th>Depósitos</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDetailState.items.map(item => {
                      const locations = Array.isArray(item.stockByLocation) ? item.stockByLocation : [];
                      const total = locations.reduce(
                        (acc, entry) => sumQuantities(acc, ensureQuantity(entry.quantity)),
                        { boxes: 0, units: 0 }
                      );
                      return (
                        <tr key={item.id}>
                          <td>{item.code}</td>
                          <td>{item.description}</td>
                          <td>
                            <div className="chip-list">
                              {locations.map(location => (
                                <span key={location.locationId || location.location?.id || Math.random()} className="badge">
                                  {location.location?.name || 'Depósito'} · {formatQuantity(location.quantity, { compact: true })}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{formatQuantity(total)}</td>
                        </tr>
                      );
                    })}
                    {groupDetailState.items.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                          No hay productos asociados al grupo seleccionado.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="section-card">
        <h3>Stock consolidado por depósito</h3>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Depósito</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {depositData.map(entry => (
                <tr key={entry.id || entry.name}>
                  <td>{entry.name || 'Depósito'}</td>
                  <td>{formatQuantity(entry.total)}</td>
                </tr>
              ))}
              {depositData.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay información consolidada de depósitos disponible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
